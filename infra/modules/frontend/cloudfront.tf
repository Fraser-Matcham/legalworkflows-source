# One distribution, one origin hostname, two origins. Both point at the same
# load balancer; what differs is the X-Origin-Target header each adds, which
# is how the ALB tells the two apart once the /api prefix is gone.
#
#   https://<domain>/            -> origin "frontend" -> ALB rule -> Next.js task
#   https://<domain>/_next/static/* -> origin "frontend", cached a year
#   https://<domain>/api/*       -> function strips "/api" -> origin "backend" -> ALB rule -> API task
#
# architecture.md decision 5 ("Why one origin"): the browser calls /api as a
# relative path, so the frontend and the API must share a hostname or the
# HttpOnly auth cookies stop working. This is where that is made true.

# AWS-managed policies, looked up by name so their IDs are never hard-coded.
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# Forwards every viewer header (including Host), cookie and query string to
# the origin. Host in particular: the backend validates the browser's Origin
# against FRONTEND_URL and sets __Host- cookies for the public domain, and Next
# builds absolute URLs from what it is asked for. CloudFront still connects to
# origin_fqdn — the header it sends is the viewer's, the TLS name is ours.
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# The browser asks for /api/projects; the backend mounts /projects. The
# prefix exists so one origin can carry both applications, and it is removed
# here, at the edge, before the request leaves CloudFront. The frontend's own
# Node proxy (frontend/src/app/api/[...path]/route.ts) does the same for local
# development and is not on the production path.
resource "aws_cloudfront_function" "strip_api_prefix" {
  name    = "${var.name_prefix}-strip-api-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Remove the /api prefix before forwarding to the backend origin"
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri === '/api') {
        request.uri = '/';
      } else if (uri.startsWith('/api/')) {
        request.uri = uri.substring(4);
      }
      return request;
    }
  EOT
}

# Stage 5 (ticket 2123): the self-hosted platform's two services sit behind
# the same load balancer, under the two prefixes supabase-js appends to
# SUPABASE_URL. Neither PostgREST nor GoTrue can serve under a prefix, so it
# is removed here exactly as /api is. Both prefixes are eight characters, so
# one function serves both.
#
#   https://<domain>/rest/v1/* -> strip "/rest/v1" -> origin "postgrest" -> ALB rule -> PostgREST task
#   https://<domain>/auth/v1/* -> strip "/auth/v1" -> origin "gotrue"    -> ALB rule -> GoTrue task
resource "aws_cloudfront_function" "strip_platform_prefix" {
  count = var.platform_routes_enabled ? 1 : 0

  name    = "${var.name_prefix}-strip-platform-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Remove the /rest/v1 or /auth/v1 prefix before forwarding to the platform origins"
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      if (uri === '/rest/v1' || uri === '/auth/v1') {
        request.uri = '/';
      } else if (uri.startsWith('/rest/v1/') || uri.startsWith('/auth/v1/')) {
        request.uri = uri.substring(8);
      }
      return request;
    }
  EOT
}

locals {
  frontend_origin_id = "frontend"
  backend_origin_id  = "backend"

  # Origin id => the path prefix routed to it. Empty until the platform
  # exists, so the distribution is unchanged by an apply with the default.
  platform_origins = var.platform_routes_enabled ? {
    postgrest = "/rest/v1"
    gotrue    = "/auth/v1"
  } : {}

  # One behaviour for "<prefix>/*" and one for the bare "<prefix>", as /api has.
  platform_behaviours = {
    for pair in setproduct(keys(local.platform_origins), ["", "/*"]) :
    "${local.platform_origins[pair[0]]}${pair[1]}" => pair[0]
  }

  # Every method, because the API needs them all and the same list keeps the
  # two dynamic behaviours identical apart from their origin.
  all_methods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.name_prefix}: ${var.domain_name}"
  aliases         = [var.domain_name]
  price_class     = var.price_class
  http_version    = "http2and3"

  # No default_root_object: this is a server-rendered application, not a
  # static site, and "/" is a page the Next server answers.

  origin {
    origin_id   = local.frontend_origin_id
    domain_name = var.origin_fqdn

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = var.origin_read_timeout_seconds
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = var.origin_verify_secret
    }

    custom_header {
      name  = "X-Origin-Target"
      value = "frontend"
    }
  }

  origin {
    origin_id   = local.backend_origin_id
    domain_name = var.origin_fqdn

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = var.origin_read_timeout_seconds
      origin_keepalive_timeout = 5
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = var.origin_verify_secret
    }

    custom_header {
      name  = "X-Origin-Target"
      value = "backend"
    }
  }

  # Everything not matched below: server-rendered pages and the files in
  # frontend/public. Not cached — a page depends on who is asking.
  default_cache_behavior {
    target_origin_id       = local.frontend_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = local.all_methods
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # Next's build output under /_next/static/ carries a content hash in every
  # filename and sets Cache-Control: immutable itself. CachingOptimized honours
  # that (up to a year) and ignores cookies and query strings for the key.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = local.frontend_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  # The API. Prefix stripped at the edge, nothing cached, every header and
  # cookie forwarded (the auth cookie is HttpOnly and lives in the request).
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = local.backend_origin_id
    viewer_protocol_policy = "https-only"
    allowed_methods        = local.all_methods
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_api_prefix.arn
    }
  }

  # "/api" with nothing after it is not matched by "/api/*"; send it the same
  # way rather than letting it fall through to the frontend.
  ordered_cache_behavior {
    path_pattern           = "/api"
    target_origin_id       = local.backend_origin_id
    viewer_protocol_policy = "https-only"
    allowed_methods        = local.all_methods
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_api_prefix.arn
    }
  }

  # Stage 5: the platform origins. Same load balancer, same secret header, a
  # target header the postgrest and gotrue modules' listener rules match.
  dynamic "origin" {
    for_each = local.platform_origins

    content {
      origin_id   = origin.key
      domain_name = var.origin_fqdn

      custom_origin_config {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = "https-only"
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_read_timeout      = var.origin_read_timeout_seconds
        origin_keepalive_timeout = 5
      }

      custom_header {
        name  = "X-Origin-Verify"
        value = var.origin_verify_secret
      }

      custom_header {
        name  = "X-Origin-Target"
        value = origin.key
      }
    }
  }

  # /rest/v1 and /auth/v1, each with and without a trailing path: nothing
  # cached, every header and query string forwarded (PostgREST's filters are
  # query strings; the keys travel in apikey and Authorization), prefix
  # stripped at the edge.
  dynamic "ordered_cache_behavior" {
    for_each = local.platform_behaviours

    content {
      path_pattern           = ordered_cache_behavior.key
      target_origin_id       = ordered_cache_behavior.value
      viewer_protocol_policy = "https-only"
      allowed_methods        = local.all_methods
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id

      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.strip_platform_prefix[0].arn
      }
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.apex_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Name = "${var.name_prefix}-cdn" }
}

# The apex, both address families, pointing at the distribution. The zone is
# the dns module's; the records live here with the thing they point at, as
# the ALB's origin record lives in the backend module.
resource "aws_route53_record" "apex_a" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id = var.zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.this.domain_name
    zone_id                = aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

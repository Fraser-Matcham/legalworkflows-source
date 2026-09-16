# The "charted" half of ticket 2086. One page: is traffic arriving, is it
# succeeding, is it fast, are the tasks healthy, and what the edge sees.
# CloudFront's widget reads from us-east-1, where that service reports;
# dashboards may mix regions even though alarms may not.
locals {
  alb_metric = "AWS/ApplicationELB"

  dashboard_widgets = [
    {
      type   = "text"
      x      = 0
      y      = 0
      width  = 24
      height = 1
      properties = {
        markdown = "## ${var.name_prefix} — service health. Alarms: [urgent](https://${var.region}.console.aws.amazon.com/cloudwatch/home?region=${var.region}#alarmsV2:?~(search~'${var.name_prefix})) · Logs: `${var.backend_log_group_name}`"
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 1
      width  = 8
      height = 6
      properties = {
        title   = "Requests per minute, by target"
        region  = var.region
        view    = "timeSeries"
        stacked = false
        stat    = "Sum"
        period  = 60
        metrics = [
          [local.alb_metric, "RequestCount", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.backend_target_group_arn_suffix, { label = "backend" }],
          [local.alb_metric, "RequestCount", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.frontend_target_group_arn_suffix, { label = "frontend" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 8
      y      = 1
      width  = 8
      height = 6
      properties = {
        title  = "Errors per 5 minutes"
        region = var.region
        view   = "timeSeries"
        stat   = "Sum"
        period = 300
        metrics = [
          [local.alb_metric, "HTTPCode_ELB_5XX_Count", "LoadBalancer", var.alb_arn_suffix, { label = "ALB 5xx (no target answered)", color = "#d62728" }],
          [local.alb_metric, "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.backend_target_group_arn_suffix, { label = "backend 5xx" }],
          [local.alb_metric, "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.frontend_target_group_arn_suffix, { label = "frontend 5xx" }],
          [local.alb_metric, "HTTPCode_Target_4XX_Count", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.backend_target_group_arn_suffix, { label = "backend 4xx" }],
          [var.name_prefix, "ReadinessFailures", { label = "readiness failures", color = "#ff7f0e" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 16
      y      = 1
      width  = 8
      height = 6
      properties = {
        title  = "Backend response time (seconds)"
        region = var.region
        view   = "timeSeries"
        period = 60
        metrics = [
          [local.alb_metric, "TargetResponseTime", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.backend_target_group_arn_suffix, { stat = "p50", label = "p50" }],
          ["...", { stat = "p95", label = "p95" }],
          ["...", { stat = "p99", label = "p99" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 0
      y      = 7
      width  = 8
      height = 6
      properties = {
        title  = "Running tasks and healthy targets"
        region = var.region
        view   = "timeSeries"
        stat   = "Minimum"
        period = 60
        metrics = [
          ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.cluster_name, "ServiceName", var.backend_service_name, { label = "backend tasks" }],
          ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.cluster_name, "ServiceName", var.frontend_service_name, { label = "frontend tasks" }],
          [local.alb_metric, "HealthyHostCount", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.backend_target_group_arn_suffix, { label = "backend healthy" }],
          [local.alb_metric, "HealthyHostCount", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.frontend_target_group_arn_suffix, { label = "frontend healthy" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 8
      y      = 7
      width  = 8
      height = 6
      properties = {
        title  = "CPU and memory (% of task)"
        region = var.region
        view   = "timeSeries"
        stat   = "Average"
        period = 60
        yAxis  = { left = { min = 0, max = 100 } }
        metrics = [
          ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", var.backend_service_name, { label = "backend CPU" }],
          ["AWS/ECS", "MemoryUtilization", "ClusterName", var.cluster_name, "ServiceName", var.backend_service_name, { label = "backend memory" }],
          ["AWS/ECS", "CPUUtilization", "ClusterName", var.cluster_name, "ServiceName", var.frontend_service_name, { label = "frontend CPU" }],
          ["AWS/ECS", "MemoryUtilization", "ClusterName", var.cluster_name, "ServiceName", var.frontend_service_name, { label = "frontend memory" }],
        ]
      }
    },
    {
      type   = "metric"
      x      = 16
      y      = 7
      width  = 8
      height = 6
      properties = {
        title  = "Edge: requests and error rate (CloudFront, global)"
        region = "us-east-1"
        view   = "timeSeries"
        period = 300
        metrics = [
          ["AWS/CloudFront", "Requests", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Sum", label = "requests" }],
          ["AWS/CloudFront", "5xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Average", label = "5xx %", yAxis = "right" }],
          ["AWS/CloudFront", "4xxErrorRate", "DistributionId", var.cloudfront_distribution_id, "Region", "Global", { stat = "Average", label = "4xx %", yAxis = "right" }],
        ]
      }
    },
  ]
}

resource "aws_cloudwatch_dashboard" "this" {
  dashboard_name = var.name_prefix
  dashboard_body = jsonencode({ widgets = local.dashboard_widgets })
}

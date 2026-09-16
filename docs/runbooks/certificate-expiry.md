# Certificate expiry

Two certificates, both from ACM, both DNS-validated, both renewed by AWS
without anyone doing anything — as long as three conditions hold.

| Certificate | Region | Used by | Covers |
| --- | --- | --- | --- |
| apex | `us-east-1` | CloudFront | `legalworkflows.co.uk` |
| origin | `eu-west-2` | the load balancer | `origin.legalworkflows.co.uk` |

ACM renews a DNS-validated certificate automatically starting 60 days
before expiry if: (1) the validation CNAME records still exist in the zone,
(2) the domain's nameservers still point at that zone, and (3) the
certificate is in use. Terraform manages (1); the registrar setting from
Stage 3, Task 7 is (2); (3) is true by construction.

**How it shows up.** AWS emails the account's contacts at 45 days if
renewal is failing (`Action required: renewal of ACM certificate …`), and
AWS Health shows an event. Users see it only if all of that was missed:
browser warnings on every page, or CloudFront answering `502` because it
no longer trusts the origin's certificate.

## 1. Check both

```sh
for region in us-east-1 eu-west-2; do
  aws acm list-certificates --region "$region" --query 'CertificateSummaryList[].CertificateArn' --output text \
  | tr '\t' '\n' | xargs -I{} aws acm describe-certificate --region "$region" --certificate-arn {} \
    --query 'Certificate.[DomainName,Status,NotAfter,RenewalSummary.RenewalStatus,RenewalSummary.RenewalStatusReason]' --output text
done
```

`ISSUED` with a `NotAfter` more than 60 days out, or `RenewalStatus`
`SUCCESS`, is fine. `PENDING_VALIDATION` under `RenewalSummary` for more
than a day means condition (1) or (2) has broken.

## 2. The validation records

```sh
cd infra && terraform plan -target=module.dns
```

A plan that wants to create `aws_route53_record.apex_validation` or
`origin_validation` records means someone deleted them; apply it. A clean
plan means the records exist and the problem is upstream of the zone:

```sh
dig +short NS legalworkflows.co.uk
terraform output -raw name_servers
```

They must match. If the registrar's nameservers changed, the zone AWS is
validating against is not the one the world sees; fix it at the registrar
(Stage 3, Task 7's steps).

## 3. If it has already expired

Renewal cannot be forced, but replacement can. Tainting a certificate makes
Terraform issue a new one, validate it against the records it also manages,
and bind CloudFront or the listener to the new ARN:

```sh
cd infra
terraform taint module.dns.aws_acm_certificate.origin     # or .apex
terraform apply
```

Validation takes minutes once the records resolve; CloudFront takes a few
more to redeploy. `prevent_destroy` is on the *zone*, not the certificates,
so this is safe.

## Do not

Do not import a certificate bought elsewhere "to be quick". ACM's imported
certificates do not renew, and this page would then be an annual event.

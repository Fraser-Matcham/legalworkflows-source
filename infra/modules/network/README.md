# `network`

Row 3.2 of the Stage 3 table. The VPC, subnets, NAT, S3 endpoint and the
three security groups that define who may talk to whom.

```
                     internet
                        |
                  internet gateway
                        |
   +--------------------+--------------------+   public subnets (one per AZ)
   |   ALB  <-443- CloudFront prefix list    |   NAT gateway (one, by default)
   +--------------------+--------------------+
                        |
   +--------------------+--------------------+   private subnets (one per AZ)
   |   backend tasks (3001)  frontend (3000)  |   default route -> NAT
   |   S3 traffic -> gateway endpoint          |
   +-------------------------------------------+
```

## Choices worth knowing about

**One NAT gateway, not one per AZ.** The cost table in `architecture.md`
budgets a single gateway (~£30/month). The trade is that an outage of that
one AZ takes outbound internet away from the private subnets in the other AZ
too — the tasks keep running and keep serving, but cannot reach Supabase or
the model providers until the AZ recovers. Set `single_nat_gateway = false`
for one per AZ when the service is worth roughly another £30/month of
resilience. Each private subnet already has its own route table, so that flip
changes route targets only; nothing is re-associated.

**A gateway endpoint for S3.** Every upload, download and PDF rendition is
S3 traffic. Routing it through the endpoint rather than the NAT is faster,
free, and independent of the NAT. Interface endpoints for ECR and CloudWatch
were left out: they cost ~£7 each per month, image pulls happen once per
deploy, and the log volume is small. Add them if NAT data-processing charges
ever become visible on the bill.

**The load balancer is "internal" by security group, not by placement.**
`architecture.md` describes the ALB as internal. CloudFront cannot reach a
truly internal ALB without VPC origins, so the ALB sits in the public subnets
with a public address, and its security group admits port 443 *only* from
CloudFront's managed origin-facing prefix list. Every packet from anywhere
else is dropped before it reaches the listener. The `frontend` module
completes this by requiring a secret origin header, so traffic must come
through this distribution rather than any CloudFront distribution.

**Egress is open on the task groups.** Supabase, Anthropic/OpenAI/Google, ECR
and CloudWatch are reached over TLS at addresses AWS and those vendors change
without notice. Narrowing to 443 is a reasonable hardening step later.
Postgres is never spoken directly (the backend uses Supabase's HTTP API), so
5432 is deliberately absent.

**No VPC flow logs yet.** Flow logs need a log group and an IAM role, both of
which the `observability` module owns; it adds them there so retention and
alarms live in one place.

## Inputs

| Name | Default | Purpose |
| --- | --- | --- |
| `name_prefix` | — | Resource name prefix |
| `vpc_cidr` | `10.0.0.0/16` | Must be /20 or larger |
| `availability_zone_count` | `2` | 2 or 3 |
| `single_nat_gateway` | `true` | See above |
| `backend_port` / `frontend_port` | `3001` / `3000` | Match the Dockerfiles' `EXPOSE` |

## Outputs

`vpc_id`, `vpc_cidr`, `availability_zones`, `public_subnet_ids`,
`private_subnet_ids`, `nat_gateway_public_ips`, and the three security group
ids (`alb_`, `backend_`, `frontend_security_group_id`).

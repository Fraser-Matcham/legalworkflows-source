data "aws_availability_zones" "available" {
  state = "available"

  # Local Zones and Wavelength Zones are opt-in and lack most services;
  # keep to the region's standard zones.
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_region" "current" {}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, var.availability_zone_count)

  # /16 -> /20 subnets: newbits = 4 gives sixteen /20s. Public subnets take the
  # first block of indexes, private the next, so adding a third AZ later does
  # not renumber anything already created.
  public_subnet_cidrs  = [for i in range(var.availability_zone_count) : cidrsubnet(var.vpc_cidr, 4, i)]
  private_subnet_cidrs = [for i in range(var.availability_zone_count) : cidrsubnet(var.vpc_cidr, 4, i + 8)]

  nat_gateway_count = var.single_nat_gateway ? 1 : var.availability_zone_count
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.name_prefix}-vpc" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-igw" }
}

# --- Public subnets: the load balancer and the NAT gateway(s) --------------

resource "aws_subnet" "public" {
  count = var.availability_zone_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.public_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  # Nothing we place here needs a public IP by default; the ALB and NAT
  # gateway get theirs explicitly. Off is the safe default for anything else.
  map_public_ip_on_launch = false

  tags = {
    Name = "${var.name_prefix}-public-${local.azs[count.index]}"
    Tier = "public"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  count = var.availability_zone_count

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# --- NAT ---------------------------------------------------------------------

resource "aws_eip" "nat" {
  count = local.nat_gateway_count

  domain = "vpc"

  tags = { Name = "${var.name_prefix}-nat-${local.azs[count.index]}" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  count = local.nat_gateway_count

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = { Name = "${var.name_prefix}-nat-${local.azs[count.index]}" }

  depends_on = [aws_internet_gateway.this]
}

# --- Private subnets: the ECS tasks ----------------------------------------

resource "aws_subnet" "private" {
  count = var.availability_zone_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${var.name_prefix}-private-${local.azs[count.index]}"
    Tier = "private"
  }
}

# One route table per private subnet even with a single NAT, so switching
# single_nat_gateway to false later only changes each table's target rather
# than re-associating subnets.
resource "aws_route_table" "private" {
  count = var.availability_zone_count

  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name_prefix}-private-${local.azs[count.index]}" }
}

resource "aws_route" "private_nat" {
  count = var.availability_zone_count

  route_table_id         = aws_route_table.private[count.index].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[var.single_nat_gateway ? 0 : count.index].id
}

resource "aws_route_table_association" "private" {
  count = var.availability_zone_count

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# --- S3 gateway endpoint -----------------------------------------------------
#
# Every document upload, download and PDF rendition moves through S3. A
# gateway endpoint routes that traffic over the AWS network instead of out
# through the NAT gateway, so it is faster, does not count against NAT data
# processing charges, and does not depend on the NAT being up. Gateway
# endpoints are free. (Interface endpoints for ECR and CloudWatch would also
# keep image pulls and logs off the NAT, but cost roughly £7 each per month
# and are not in the cost table; image pulls happen once per deploy, so the NAT
# is the right answer for those at this scale.)
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = aws_route_table.private[*].id

  tags = { Name = "${var.name_prefix}-s3-endpoint" }
}

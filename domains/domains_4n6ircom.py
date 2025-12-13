from aws_cdk import (
    Duration,
    RemovalPolicy,
    Stack,
    aws_certificatemanager as _acm,
    aws_cloudfront as _cloudfront,
    aws_cloudfront_origins as _origins,
    aws_iam as _iam,
    aws_logs as _logs,
    aws_route53 as _route53,
    aws_route53_targets as _targets,
    aws_s3 as _s3,
    aws_ssm as _ssm
)

from constructs import Construct

class Domains4n6irCom(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        account = Stack.of(self).account
        region = Stack.of(self).region

    ### HOSTZONE ###

        policy_statement = _iam.PolicyStatement(
            principals = [
                _iam.ServicePrincipal('route53.amazonaws.com')
            ],
            actions = [
                'logs:CreateLogStream',
                'logs:PutLogEvents'
            ],
            resources=[
                'arn:aws:logs:'+region+':'+account+':log-group:*'
            ]
        )

        resourcepolicy = _logs.ResourcePolicy(
            self, 'resourcepolicy',
            policy_statements = [
                policy_statement
            ],
            resource_policy_name = 'Route53LogsPolicy4n6irCom'
        )

        logs = _logs.LogGroup(
            self, 'logs',
            log_group_name = '/aws/route53/4n6ircom',
            retention = _logs.RetentionDays.THIRTEEN_MONTHS,
            removal_policy = RemovalPolicy.DESTROY
        )

        hostzone = _route53.PublicHostedZone(
            self, 'hostzone', 
            zone_name = '4n6ir.com',
            comment = '4n6ir.com',
            query_logs_log_group_arn = logs.log_group_arn
        )

    ### PARAMETER ###

        parameter = _ssm.StringParameter(
            self, 'parameter',
            description = '4n6ir.com',
            parameter_name = '/route53/4n6ircom',
            string_value = hostzone.hosted_zone_id,
            tier = _ssm.ParameterTier.STANDARD
        )

    ### MAIL RECORDS ###

        mx = _route53.MxRecord(
            self, 'mx',
            values = [
                _route53.MxRecordValue(
                    host_name = 'mx01.mail.icloud.com',
                    priority = 10
                ),
                _route53.MxRecordValue(
                    host_name = 'mx02.mail.icloud.com',
                    priority = 10
                )
            ],
            zone = hostzone
        )

        spf = _route53.TxtRecord(
            self, 'spf',
            zone = hostzone,
            values = [
                'apple-domain=QrN2dB5mqCpHXDmp',
                'v=spf1 include:icloud.com ~all',
                'google-site-verification=48g-lZt5fMJAGuNoJeufLTBmpiZD_n9C1Ep7cg0paas'
            ]
        )

        dkim = _route53.CnameRecord(
            self, 'dkim',
            record_name = 'sig1._domainkey',
            zone = hostzone,
            domain_name = 'sig1.dkim.4n6ir.com.at.icloudmailadmin.com'
        )

        dmarc = _route53.TxtRecord(
            self, 'dmarc',
            zone = hostzone,
            record_name = '_dmarc',
            values = ['v=DMARC1; p=reject; rua=mailto:hello@4n6ir.com; ruf=mailto:hello@4n6ir.com;'],
            ttl = Duration.minutes(300)
        )

    ### DOMAIN VALIDATION ###

        _route53.TxtRecord(
            self, '_github-challenge-4n6ir.blog',
            zone = hostzone,
            record_name = '_github-challenge-4n6ir.blog',
            values = ['0aca00d55d'],
            ttl = Duration.minutes(300)
        )

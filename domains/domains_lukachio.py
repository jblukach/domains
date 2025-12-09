from aws_cdk import (
    Duration,
    RemovalPolicy,
    Stack,
    aws_iam as _iam,
    aws_logs as _logs,
    aws_route53 as _route53,
    aws_ssm as _ssm
)

from constructs import Construct

class DomainsLukachIo(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        account = Stack.of(self).account
        region = Stack.of(self).region

    ### ROUTE53 ###

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
            resource_policy_name = 'Route53LogsPolicyLukachIo'
        )

        logs = _logs.LogGroup(
            self, 'logs',
            log_group_name = '/aws/route53/lukachio',
            retention = _logs.RetentionDays.THIRTEEN_MONTHS,
            removal_policy = RemovalPolicy.DESTROY
        )

        hostzone = _route53.PublicHostedZone(
            self, 'hostzone', 
            zone_name = 'lukach.io',
            comment = 'lukach.io',
            query_logs_log_group_arn = logs.log_group_arn
        )

    ### PARAMETER ###

        parameter = _ssm.StringParameter(
            self, 'parameter',
            description = 'lukach.io',
            parameter_name = '/route53/lukachio',
            string_value = hostzone.hosted_zone_id,
            tier = _ssm.ParameterTier.STANDARD
        )

    ### DNS RECORDS ###

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
                'apple-domain=iJt7M09hmfaQJOAk',
                'v=spf1 include:icloud.com ~all',
                'google-site-verification=Q5p9swO-SAWvSQvFLboYO_pxI7xU1rJXjIvEQeXWr8U'
            ]
        )

        dkim = _route53.CnameRecord(
            self, 'dkim',
            record_name = 'sig1._domainkey',
            zone = hostzone,
            domain_name = 'sig1.dkim.lukach.io.at.icloudmailadmin.com'
        )

        dmarc = _route53.TxtRecord(
            self, 'dmarc',
            zone = hostzone,
            record_name = '_dmarc',
            values = ['v=DMARC1; p=reject; rua=mailto:hello@lukach.io; ruf=mailto:hello@lukach.io;'],
            ttl = Duration.minutes(300)
        )

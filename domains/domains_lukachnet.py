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

class DomainsLukachNet(Stack):
    
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
            resource_policy_name = 'Route53LogsPolicyLukachNet'
        )

        logs = _logs.LogGroup(
            self, 'logs',
            log_group_name = '/aws/route53/lukachnet',
            retention = _logs.RetentionDays.THIRTEEN_MONTHS,
            removal_policy = RemovalPolicy.DESTROY
        )

        hostzone = _route53.PublicHostedZone(
            self, 'hostzone', 
            zone_name = 'lukach.net',
            comment = 'lukach.net',
            query_logs_log_group_arn = logs.log_group_arn
        )

    ### PARAMETER ###

        parameter = _ssm.StringParameter(
            self, 'parameter',
            description = 'lukach.net',
            parameter_name = '/route53/lukachnet',
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
                'apple-domain=gOUpiYTLd4M1rhEa',
                'v=spf1 include:icloud.com ~all',
                'google-site-verification=LNWHvBz7ozTPcZmzOMdnM2cmg4oX2HtTfjoPRrjpgYY'
                
            ]
        )

        dkim = _route53.CnameRecord(
            self, 'dkim',
            record_name = 'sig1._domainkey',
            zone = hostzone,
            domain_name = 'sig1.dkim.lukach.net.at.icloudmailadmin.com'
        )

        dmarc = _route53.TxtRecord(
            self, 'dmarc',
            zone = hostzone,
            record_name = '_dmarc',
            values = ['v=DMARC1; p=reject; rua=mailto:hello@lukach.net; ruf=mailto:hello@lukach.net;'],
            ttl = Duration.minutes(300)
        )

    ### ACM CERTIFICATE ###

        acm = _acm.Certificate(
            self, 'acm',
            domain_name = 'lukach.net',
            subject_alternative_names = [
                'www.lukach.net'
            ],
            validation = _acm.CertificateValidation.from_dns(hostzone)
        )

    ### S3 BUCKET ###

        bucket = _s3.Bucket(
            self, 'bucket',
            encryption = _s3.BucketEncryption.S3_MANAGED,
            block_public_access = _s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy = RemovalPolicy.DESTROY,
            auto_delete_objects = True,
            enforce_ssl = True,
            versioned = False
        )

    ### CLOUDFRONT FUNCTIONS ###

        function = _cloudfront.Function(
            self, 'function',
            code = _cloudfront.FunctionCode.from_file(
                file_path = 'redirect/redirect.js'
            ),
            runtime = _cloudfront.FunctionRuntime.JS_2_0
        )

    ### CLOUDFRONT DISTRIBUTIONS ###

        distribution = _cloudfront.Distribution(
            self, 'distribution',
            comment = 'lukach.net',
            default_behavior = _cloudfront.BehaviorOptions(
                origin = _origins.S3BucketOrigin.with_origin_access_control(bucket),
                viewer_protocol_policy = _cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy = _cloudfront.CachePolicy.CACHING_DISABLED,
                function_associations = [
                    _cloudfront.FunctionAssociation(
                        function = function,
                        event_type = _cloudfront.FunctionEventType.VIEWER_REQUEST
                    )   
                ]
            ),
            domain_names = [
                'lukach.net',
                'www.lukach.net'
            ],
            error_responses = [
                _cloudfront.ErrorResponse(
                    http_status = 404,
                    response_http_status = 200,
                    response_page_path = '/'
                )
            ],
            minimum_protocol_version = _cloudfront.SecurityPolicyProtocol.TLS_V1_3_2025,
            price_class = _cloudfront.PriceClass.PRICE_CLASS_ALL,
            http_version = _cloudfront.HttpVersion.HTTP2_AND_3,
            enable_ipv6 = True,
            certificate = acm
        )

    ### WEBSITE RECORDS ###

        alias = _route53.ARecord(
            self, 'alias',
            zone = hostzone,
            record_name = 'lukach.net',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(distribution))
        )

        www = _route53.ARecord(
            self, 'www',
            zone = hostzone,
            record_name = 'www.lukach.net',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(distribution))
        )

        aliasaaa = _route53.AaaaRecord(
            self, 'aliasaaa',
            zone = hostzone,
            record_name = 'lukach.net',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(distribution))
        )

        wwwaaa = _route53.AaaaRecord(
            self, 'wwwaaa',
            zone = hostzone,
            record_name = 'www.lukach.net',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(distribution))
        )

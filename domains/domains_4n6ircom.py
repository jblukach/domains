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
    aws_s3_deployment as _deployment
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

        osintprod = _route53.NsRecord(
            self, 'osintprod',
            zone = hostzone,
            record_name = 'osint.4n6ir.com',
            values=[
                'ns-67.awsdns-08.com',
                'ns-1844.awsdns-38.co.uk',
                'ns-1400.awsdns-47.org',
                'ns-930.awsdns-52.net'
            ]
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

    ### DEV SES RECORDS ###

        devsesone = _route53.CnameRecord(
            self, 'devsesone',
            record_name = 'dg4uvxot4lhmf5f4gs7lossuq4fayydi._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = 'dg4uvxot4lhmf5f4gs7lossuq4fayydi.dkim.amazonses.com'
        )

        devsestwo = _route53.CnameRecord(
            self, 'devsestwo',
            record_name = 'iwkswgbo5r3fjr5rnktzqxgpb3xesbo2._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = 'iwkswgbo5r3fjr5rnktzqxgpb3xesbo2.dkim.amazonses.com'
        )

        devsesthree = _route53.CnameRecord(
            self, 'devsesthree',
            record_name = '6tg2jnp7kjqrfuoyqqhtsqslc33xw2kp._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = '6tg2jnp7kjqrfuoyqqhtsqslc33xw2kp.dkim.amazonses.com'
        )

    ### BETA SES RECORDS ###

        betasesone = _route53.CnameRecord(
            self, 'betasesone',
            record_name = 'ke5gf6evjcnpsfx3gqh3acypgahhdjc4._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = 'ke5gf6evjcnpsfx3gqh3acypgahhdjc4.dkim.amazonses.com'
        )

        betasestwo = _route53.CnameRecord(
            self, 'betasestwo',
            record_name = 'vz4otdnzapaicnadtei3qrcbwzmhwmeq._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = 'vz4otdnzapaicnadtei3qrcbwzmhwmeq.dkim.amazonses.com'
        )

        betasesthree = _route53.CnameRecord(
            self, 'betasesthree',
            record_name = 'wk345qw3pt4iltvjqfj6mratzljxtezo._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = 'wk345qw3pt4iltvjqfj6mratzljxtezo.dkim.amazonses.com'
        )

    ### PROD SES RECORDS ###

        prodsesone = _route53.CnameRecord(
            self, 'prodsesone',
            record_name = '2rdtx2uh2mxmsvluqlaqqv7x7nhazmwa._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = '2rdtx2uh2mxmsvluqlaqqv7x7nhazmwa.dkim.amazonses.com'
        )

        prodsestwo = _route53.CnameRecord(
            self, 'prodsestwo',
            record_name = 'canqq3yhqre6qwcnmx2y36u5mkcl5sbx._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = 'canqq3yhqre6qwcnmx2y36u5mkcl5sbx.dkim.amazonses.com'
        )

        prodsesthree = _route53.CnameRecord(
            self, 'prodsesthree',
            record_name = '2cwyuhozewy4suy44hmscnurhwwohrbe._domainkey.4n6ir.com',
            zone = hostzone,
            domain_name = '2cwyuhozewy4suy44hmscnurhwwohrbe.dkim.amazonses.com'
        )

    ### DOMAIN VALIDATION ###

        _route53.TxtRecord(
            self, '_gh-4n6ir-o.4n6ir.com',
            zone = hostzone,
            record_name = '_gh-4n6ir-o.4n6ir.com',
            values = [
                '78cd1b1e99'
            ],
            ttl = Duration.minutes(300)
        )

        _route53.TxtRecord(
            self, '_gh-4n6ir-o.blog.4n6ir.com',
            zone = hostzone,
            record_name = '_gh-4n6ir-o.blog.4n6ir.com',
            values = [
                '574ce20909'
            ],
            ttl = Duration.minutes(300)
        )

        _route53.TxtRecord(
            self, '_gh-4n6ir-o.www.4n6ir.com',
            zone = hostzone,
            record_name = '_gh-4n6ir-o.www.4n6ir.com',
            values = [
                '01b114cf2c'
            ],
            ttl = Duration.minutes(300)
        )

    ### ACM CERTIFICATE ###

        acm = _acm.Certificate(
            self, 'acm',
            domain_name = '4n6ir.com',
            subject_alternative_names = [
                'www.4n6ir.com'
            ],
            validation = _acm.CertificateValidation.from_dns(hostzone)
        )

        cdnacm = _acm.Certificate(
            self, 'cdnacm',
            domain_name = 'cdn.4n6ir.com',
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

        cache = _s3.Bucket(
            self, 'cache',
            encryption = _s3.BucketEncryption.S3_MANAGED,
            block_public_access = _s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy = RemovalPolicy.DESTROY,
            auto_delete_objects = True,
            enforce_ssl = True,
            versioned = False
        )

        deployment = _deployment.BucketDeployment(
            self, 'deployment',
            sources = [_deployment.Source.asset('cache')],
            destination_bucket = cache,
            prune = False
        )

    ### CLOUDFRONT FUNCTIONS ###

        function = _cloudfront.Function(
            self, 'function',
            code = _cloudfront.FunctionCode.from_file(
                file_path = 'redirect/4n6ir.js'
            ),
            runtime = _cloudfront.FunctionRuntime.JS_2_0
        )

    ### CLOUDFRONT DISTRIBUTIONS ###

        distribution = _cloudfront.Distribution(
            self, 'distribution',
            comment = '4n6ir.com',
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
                '4n6ir.com',
                'www.4n6ir.com'
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

        cdndistribution = _cloudfront.Distribution(
            self, 'cdndistribution',
            comment = 'cdn.4n6ir.com',
            default_behavior = _cloudfront.BehaviorOptions(
                origin = _origins.S3BucketOrigin.with_origin_access_control(cache),
                viewer_protocol_policy = _cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cache_policy = _cloudfront.CachePolicy.CACHING_OPTIMIZED
            ),
            domain_names = [
                'cdn.4n6ir.com'
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
            certificate = cdnacm
        )

    ### WEBSITE RECORDS ###

        alias = _route53.ARecord(
            self, 'alias',
            zone = hostzone,
            record_name = '4n6ir.com',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(distribution))
        )

        blog = _route53.CnameRecord(
            self, 'blog',
            record_name = 'blog.4n6ir.com',
            zone = hostzone,
            domain_name = '4n6ir.github.io'
        )

        cdn = _route53.ARecord(
            self, 'cdn',
            zone = hostzone,
            record_name = 'cdn.4n6ir.com',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(cdndistribution))
        )

        www = _route53.ARecord(
            self, 'www',
            zone = hostzone,
            record_name = 'www.4n6ir.com',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(distribution))
        )

        aliasaaa = _route53.AaaaRecord(
            self, 'aliasaaa',
            zone = hostzone,
            record_name = '4n6ir.com',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(distribution))
        )

        cdnaaa = _route53.AaaaRecord(
            self, 'cdnaaa',
            zone = hostzone,
            record_name = 'cdn.4n6ir.com',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(cdndistribution))
        )

        wwwaaa = _route53.AaaaRecord(
            self, 'wwwaaa',
            zone = hostzone,
            record_name = 'www.4n6ir.com',
            target = _route53.RecordTarget.from_alias(_targets.CloudFrontTarget(distribution))
        )

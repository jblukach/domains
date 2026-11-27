import os
import unittest

os.environ.setdefault('JSII_RUNTIME_PACKAGE_CACHE_ROOT', os.path.expanduser('~/.jsii-package-cache'))

from aws_cdk import App, Environment
from aws_cdk.assertions import Match, Template

from domains.domains_4n6ircom import Domains4n6irCom


class DashboardStackTest(unittest.TestCase):
    def test_dashboard_uses_uncached_viewer_request_lambda(self):
        app = App()
        stack = Domains4n6irCom(
            app, 'Test', env=Environment(account='123456789012', region='us-east-1')
        )
        template = Template.from_stack(stack)
        template.has_resource_properties('AWS::CloudFront::Distribution', {
            'DistributionConfig': Match.object_like({
                'Aliases': ['4n6ir.com', 'www.4n6ir.com'],
                'DefaultCacheBehavior': Match.object_like({
                    'CachePolicyId': '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
                    'AllowedMethods': [
                        'GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'POST', 'DELETE',
                    ],
                    'LambdaFunctionAssociations': [{
                        'EventType': 'viewer-request',
                        'LambdaFunctionARN': Match.any_value(),
                    }],
                    'FunctionAssociations': Match.absent(),
                }),
            }),
        })
        template.has_resource_properties('AWS::Lambda::Function', {
            'Handler': 'index.handler',
            'Runtime': 'nodejs22.x',
            'Environment': Match.absent(),
        })
        policies = template.find_resources('AWS::IAM::Policy')
        policy_text = str(policies)
        self.assertIn('arn:aws:ssm:us-east-1:*:parameter/cognito/issuer', policy_text)
        self.assertIn('arn:aws:ssm:us-west-2:*:parameter/cognito/issuer', policy_text)
        self.assertIn('arn:aws:ssm:us-west-2:*:parameter/cognito/secret', policy_text)
        self.assertIn('arn:aws:secretsmanager:us-west-2:*:secret:credentials-*', policy_text)
        self.assertIn('secretsmanager.us-west-2.amazonaws.com', policy_text)


if __name__ == '__main__':
    unittest.main()

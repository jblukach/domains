#!/usr/bin/env python3
import os

import aws_cdk as cdk

from domains.domains_lukachio import DomainsLukachIo
from domains.domains_lukachnet import DomainsLukachNet
from domains.domains_stack import DomainsStack

app = cdk.App()

DomainsLukachIo(
    app, 'DomainsLukachIo',
    env = cdk.Environment(
        account = os.getenv('CDK_DEFAULT_ACCOUNT'),
        region = 'us-east-1'
    ),
    synthesizer = cdk.DefaultStackSynthesizer(
        qualifier = 'lukach'
    )
)

DomainsLukachNet(
    app, 'DomainsLukachNet',
    env = cdk.Environment(
        account = os.getenv('CDK_DEFAULT_ACCOUNT'),
        region = 'us-east-1'
    ),
    synthesizer = cdk.DefaultStackSynthesizer(
        qualifier = 'lukach'
    )
)

DomainsStack(
    app, 'DomainsStack',
    env = cdk.Environment(
        account = os.getenv('CDK_DEFAULT_ACCOUNT'),
        region = 'us-east-1'
    ),
    synthesizer = cdk.DefaultStackSynthesizer(
        qualifier = 'lukach'
    )
)

cdk.Tags.of(app).add('Alias','domains')
cdk.Tags.of(app).add('GitHub','https://github.com/jblukach/domains')
cdk.Tags.of(app).add('Org','lukach.io')

app.synth()
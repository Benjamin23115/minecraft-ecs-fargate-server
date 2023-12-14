#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { mcEcsFargateServerStack } from '../src/lib/mc-ecs-fargate-server-stack/mc-ecs-fargate-server-stack';
import { mcEcsFargateServerInfrastructureStack } from '../src/lib/mc-ecs-fargate-server-infrastructure-stack/mc-ecs-fargate-server-infrastructure-stack';

const { deploymentType, applicationName, applicationAbbreviation, } = process.env;
const env = {
    region: process.env.region,
    account: process.env.account,
};

const app = new cdk.App();

new mcEcsFargateServerInfrastructureStack(app, `${applicationName}-shared-mcEcsFargateServerInfrastructureStack`);
new mcEcsFargateServerStack(app, `${applicationName}-${deploymentType}-mcEcsFargateServerStack`,{ env });

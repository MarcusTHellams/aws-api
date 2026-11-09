import * as path from 'node:path';
import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib/core';
import {
  AuthorizationType,
  EndpointType,
  LambdaIntegration,
  RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { ManagedPolicy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import { DirectProductsApi } from './integrations/direct-products-api';

export class AwsApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const health = new NodejsFunction(this, 'HealthFunction', {
      entry: path.resolve('src/handlers/health.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      memorySize: 128,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'HealthLogs', {
        retention: RetentionDays.ONE_WEEK,
      }),
    });

    const api = new RestApi(this, 'Api', {
      description: 'AWS API starter',
      endpointConfiguration: { types: [EndpointType.REGIONAL] },
      defaultMethodOptions: { authorizationType: AuthorizationType.IAM },
      deployOptions: { stageName: 'prod' },
    });

    const healthMethod = api.root
      .addResource('health')
      .addMethod('GET', new LambdaIntegration(health, { allowTestInvoke: false }));

    const products = new NodejsFunction(this, 'ProductsFunction', {
      entry: path.resolve('src/features/products/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      memorySize: 128,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'ProductsLogs', {
        retention: RetentionDays.ONE_WEEK,
      }),
    });
    const productsIntegration = new LambdaIntegration(products, { allowTestInvoke: false });
    const productsResource = api.root.addResource('products');
    productsResource.addMethod('GET', productsIntegration);
    productsResource.addResource('{productId}').addMethod('GET', productsIntegration);

    const productsReadPolicy = new ManagedPolicy(this, 'ProductsReadPolicy', {
      description: 'Allows backend services to read products in prod',
      statements: [
        new PolicyStatement({
          actions: ['execute-api:Invoke'],
          resources: [
            api.arnForExecuteApi('GET', '/products', api.deploymentStage.stageName),
            api.arnForExecuteApi('GET', '/products/*', api.deploymentStage.stageName),
          ],
        }),
      ],
    });

    const orders = new NodejsFunction(this, 'OrdersFunction', {
      entry: path.resolve('src/features/orders/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      memorySize: 128,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'OrdersLogs', {
        retention: RetentionDays.ONE_WEEK,
      }),
    });
    const ordersIntegration = new LambdaIntegration(orders, { allowTestInvoke: false });
    const ordersResource = api.root.addResource('orders');
    ordersResource.addMethod('GET', ordersIntegration);
    ordersResource.addResource('{orderId}').addMethod('GET', ordersIntegration);

    const ordersReadPolicy = new ManagedPolicy(this, 'OrdersReadPolicy', {
      description: 'Allows backend services to read orders in prod',
      statements: [
        new PolicyStatement({
          actions: ['execute-api:Invoke'],
          resources: [
            api.arnForExecuteApi('GET', '/orders', api.deploymentStage.stageName),
            api.arnForExecuteApi('GET', '/orders/*', api.deploymentStage.stageName),
          ],
        }),
      ],
    });

    const invokePolicy = new ManagedPolicy(this, 'ApiInvokePolicy', {
      description: 'Allows backend services to invoke GET /health on this API in prod',
      statements: [
        new PolicyStatement({
          actions: ['execute-api:Invoke'],
          resources: [api.arnForExecuteApi('GET', '/health', api.deploymentStage.stageName)],
        }),
      ],
    });

    const directProducts = new DirectProductsApi(this, 'DirectProducts', api);

    const visibilityConfig = (metricName: string): CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName,
    });

    const webAcl = new CfnWebACL(this, 'ApiWebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: visibilityConfig('ApiWebAcl'),
      rules: [
        {
          name: 'IpRateLimit',
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: 'IP',
              limit: 1000,
              evaluationWindowSec: 300,
            },
          },
          visibilityConfig: visibilityConfig('IpRateLimit'),
        },
        ...['AWSManagedRulesCommonRuleSet', 'AWSManagedRulesKnownBadInputsRuleSet'].map(
          (name, index): CfnWebACL.RuleProperty => ({
            name,
            priority: index + 1,
            overrideAction: { none: {} },
            statement: { managedRuleGroupStatement: { vendorName: 'AWS', name } },
            visibilityConfig: visibilityConfig(name),
          }),
        ),
      ],
    });

    const association = new CfnWebACLAssociation(this, 'ApiWafAssociation', {
      resourceArn: api.deploymentStage.stageArn,
      webAclArn: webAcl.attrArn,
    });
    association.node.addDependency(api.deploymentStage);

    new CfnOutput(this, 'ApiUrl', { value: api.url });
    new CfnOutput(this, 'HealthUrl', { value: api.urlForPath(healthMethod.resource.path) });
    new CfnOutput(this, 'ProductsUrl', { value: api.urlForPath('/products') });
    new CfnOutput(this, 'ProductsReadPolicyArn', { value: productsReadPolicy.managedPolicyArn });
    new CfnOutput(this, 'OrdersUrl', { value: api.urlForPath('/orders') });
    new CfnOutput(this, 'OrdersReadPolicyArn', { value: ordersReadPolicy.managedPolicyArn });
    new CfnOutput(this, 'ApiInvokePolicyArn', { value: invokePolicy.managedPolicyArn });
    new CfnOutput(this, 'WebAclArn', { value: webAcl.attrArn });
    new CfnOutput(this, 'DirectProductExampleUrl', {
      value: api.urlForPath('/direct-products/notebook'),
    });
    new CfnOutput(this, 'DirectProductsTableName', { value: directProducts.table.tableName });
    new CfnOutput(this, 'DirectProductsReadPolicyArn', {
      value: directProducts.readPolicy.managedPolicyArn,
    });
  }
}

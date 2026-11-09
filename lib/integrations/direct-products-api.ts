import {
  AuthorizationType,
  AwsIntegration,
  PassthroughBehavior,
  type RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Fn, RemovalPolicy } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';

const readTemplate = (name: string): string =>
  readFileSync(resolve('lib/integrations/templates', name), 'utf8');

export class DirectProductsApi extends Construct {
  readonly table: TableV2;
  readonly readPolicy: ManagedPolicy;

  constructor(scope: Construct, id: string, api: RestApi) {
    super(scope, id);

    this.table = new TableV2(this, 'Table', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const role = new Role(this, 'GatewayRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
    });
    role.addToPolicy(
      new PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [this.table.tableArn],
      }),
    );

    const integration = new AwsIntegration({
      service: 'dynamodb',
      action: 'GetItem',
      integrationHttpMethod: 'POST',
      options: {
        credentialsRole: role,
        passthroughBehavior: PassthroughBehavior.NEVER,
        requestTemplates: {
          'application/json': Fn.sub(readTemplate('get-product.request.vtl'), {
            TableName: this.table.tableName,
          }),
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: { 'application/json': readTemplate('get-product.response.vtl') },
          },
          {
            selectionPattern: '[45]\\d{2}',
            statusCode: '502',
            responseTemplates: { 'application/json': readTemplate('get-product.error.vtl') },
          },
        ],
      },
    });

    api.root
      .addResource('direct-products')
      .addResource('{productId}')
      .addMethod('GET', integration, {
        authorizationType: AuthorizationType.IAM,
        requestParameters: { 'method.request.path.productId': true },
        methodResponses: [{ statusCode: '200' }, { statusCode: '404' }, { statusCode: '502' }],
      });

    this.readPolicy = new ManagedPolicy(this, 'ReadPolicy', {
      description: 'Allows backend services to read direct products in prod',
      statements: [
        new PolicyStatement({
          actions: ['execute-api:Invoke'],
          resources: [
            api.arnForExecuteApi('GET', '/direct-products/*', api.deploymentStage.stageName),
          ],
        }),
      ],
    });
  }
}
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

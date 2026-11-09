import { App } from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsApiStack } from '../lib/aws-api-stack';
import { handler } from '../src/handlers/health';
import { restEvent } from './fixtures/rest-event';

describe('AWS API', () => {
  const template = Template.fromStack(new AwsApiStack(new App(), 'TestStack'));

  it('returns a JSON health response', () => {
    expect(handler(restEvent('/health'))).toEqual({
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: JSON.stringify({ status: 'ok' }),
    });
  });

  it('requires IAM authentication on every method and integrates the health Lambda', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 0);
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.hasResourceProperties('AWS::ApiGateway::RestApi', {
      EndpointConfiguration: { Types: ['REGIONAL'] },
    });
    template.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'health' });
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method'));
    expect(methods).toHaveLength(6);
    for (const method of methods) {
      expect(method['Properties']['AuthorizationType']).toBe('AWS_IAM');
    }
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      Integration: { Type: 'AWS_PROXY', IntegrationHttpMethod: 'POST' },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Handler: 'index.handler',
      Code: { S3Bucket: Match.anyValue(), S3Key: Match.anyValue() },
    });
    template.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
      SourceArn: Match.anyValue(),
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  });

  it('provides an invoke policy limited to this API health endpoint in prod', () => {
    template.resourceCountIs('AWS::IAM::ManagedPolicy', 4);
    template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: Match.anyValue(),
          },
        ],
        Version: '2012-10-17',
      },
    });
    const policies = Object.values(template.findResources('AWS::IAM::ManagedPolicy')).filter(
      (policy) => policy['Properties']['Description'].includes('GET /health'),
    );
    const resource = JSON.stringify(
      policies[0]?.['Properties']['PolicyDocument']['Statement'][0]['Resource'],
    );
    const apiId = Object.keys(template.findResources('AWS::ApiGateway::RestApi'))[0];
    const stageId = Object.keys(template.findResources('AWS::ApiGateway::Stage'))[0];
    template.hasResourceProperties('AWS::ApiGateway::Stage', { StageName: 'prod' });
    expect(resource).toContain('/GET/health');
    expect(resource).toContain(stageId);
    expect(resource).toContain(apiId);
    expect(resource).not.toContain('*');
    template.hasOutput('ApiInvokePolicyArn', { Value: Match.anyValue() });
  });

  it('routes both product endpoints to one separate Lambda with scoped read access', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method'));
    const productMethods = methods.filter((method) =>
      JSON.stringify(method['Properties']['Integration']).includes('ProductsFunction'),
    );
    expect(productMethods).toHaveLength(2);
    expect(productMethods[0]?.['Properties']['Integration']['Uri']).toEqual(
      productMethods[1]?.['Properties']['Integration']['Uri'],
    );
    const policies = Object.values(template.findResources('AWS::IAM::ManagedPolicy'));
    const productsPolicy = policies.find((policy) =>
      policy['Properties']['Description'].includes('read products'),
    );
    const statements = productsPolicy?.['Properties']['PolicyDocument']['Statement'];
    expect(statements).toHaveLength(1);
    expect(statements[0]['Action']).toBe('execute-api:Invoke');
    expect(statements[0]['Resource']).toHaveLength(2);
    const resources = JSON.stringify(statements[0]['Resource']);
    expect(resources).toContain('/GET/products');
    expect(resources).toContain('/GET/products/*');
    expect(resources).not.toContain('/health');
    template.hasOutput('ProductsReadPolicyArn', { Value: Match.anyValue() });
  });

  it('routes both order endpoints to one separate Lambda with scoped read access', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method'));
    const orderMethods = methods.filter((method) =>
      JSON.stringify(method['Properties']['Integration']).includes('OrdersFunction'),
    );
    expect(orderMethods).toHaveLength(2);
    expect(orderMethods[0]?.['Properties']['Integration']['Uri']).toEqual(
      orderMethods[1]?.['Properties']['Integration']['Uri'],
    );
    const policies = Object.values(template.findResources('AWS::IAM::ManagedPolicy'));
    const ordersPolicy = policies.find((policy) =>
      policy['Properties']['Description'].includes('read orders'),
    );
    const statements = ordersPolicy?.['Properties']['PolicyDocument']['Statement'];
    expect(statements).toHaveLength(1);
    expect(statements[0]['Action']).toBe('execute-api:Invoke');
    expect(statements[0]['Resource']).toHaveLength(2);
    const resources = JSON.stringify(statements[0]['Resource']);
    expect(resources).toContain('/GET/orders');
    expect(resources).toContain('/GET/orders/*');
    expect(resources).not.toContain('/health');
    template.hasOutput('OrdersReadPolicyArn', { Value: Match.anyValue() });
  });

  it('integrates DynamoDB directly without adding a Lambda', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3);
    template.resourceCountIs('AWS::DynamoDB::GlobalTable', 1);
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    });
    const tables = Object.values(template.findResources('AWS::DynamoDB::GlobalTable'));
    expect(tables[0]?.['DeletionPolicy']).toBe('Retain');
    const methods = Object.values(template.findResources('AWS::ApiGateway::Method'));
    const direct = methods.filter(
      (method) => method['Properties']['Integration']['Type'] === 'AWS',
    );
    expect(direct).toHaveLength(1);
    const integration = direct[0]?.['Properties']['Integration'];
    expect(direct[0]?.['Properties']['HttpMethod']).toBe('GET');
    expect(integration['IntegrationHttpMethod']).toBe('POST');
    expect(JSON.stringify(integration['Uri'])).toContain('dynamodb:action/GetItem');
    expect(integration['PassthroughBehavior']).toBe('NEVER');
    expect(integration['Credentials']).toBeDefined();
    const request = JSON.stringify(integration['RequestTemplates']);
    const tableId = Object.keys(template.findResources('AWS::DynamoDB::GlobalTable'))[0];
    expect(request).toContain(tableId);
    expect(request).toContain('escapeJavaScript');
    expect(request).toContain('productId');
    const responses = integration['IntegrationResponses'];
    expect(responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          StatusCode: '200',
          ResponseTemplates: {
            'application/json': expect.stringContaining('$context.responseOverride.status = 404'),
          },
        }),
        expect.objectContaining({ StatusCode: '502', SelectionPattern: '[45]\\d{2}' }),
      ]),
    );
    expect(direct[0]?.['Properties']['MethodResponses']).toEqual([
      { StatusCode: '200' },
      { StatusCode: '404' },
      { StatusCode: '502' },
    ]);
  });

  it('separates direct product caller access from narrowly scoped DynamoDB access', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: { Service: 'apigateway.amazonaws.com' },
          },
        ],
        Version: '2012-10-17',
      },
    });
    const tableId = Object.keys(template.findResources('AWS::DynamoDB::GlobalTable'))[0];
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 'dynamodb:GetItem',
            Effect: 'Allow',
            Resource: { 'Fn::GetAtt': [tableId, 'Arn'] },
          },
        ],
        Version: '2012-10-17',
      },
    });
    const policies = Object.values(template.findResources('AWS::IAM::ManagedPolicy'));
    const policy = policies.find((item) =>
      item['Properties']['Description'].includes('direct products'),
    );
    const statements = policy?.['Properties']['PolicyDocument']['Statement'];
    expect(statements).toHaveLength(1);
    expect(statements[0]['Action']).toBe('execute-api:Invoke');
    expect(JSON.stringify(statements[0]['Resource'])).toContain('/GET/direct-products/*');
    expect(JSON.stringify(statements[0]['Resource'])).not.toContain('/GET/products');
    template.hasOutput('DirectProductsTableName', { Value: Match.anyValue() });
    template.hasOutput('DirectProductsReadPolicyArn', { Value: Match.anyValue() });
  });

  it('blocks common exploits and rate limits by the connecting IP', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'REGIONAL',
      DefaultAction: { Allow: {} },
      Rules: [
        Match.objectLike({
          Priority: 0,
          Action: { Block: {} },
          Statement: {
            RateBasedStatement: { AggregateKeyType: 'IP', Limit: 1000, EvaluationWindowSec: 300 },
          },
        }),
        ...['AWSManagedRulesCommonRuleSet', 'AWSManagedRulesKnownBadInputsRuleSet'].map((name) =>
          Match.objectLike({
            OverrideAction: { None: {} },
            Statement: { ManagedRuleGroupStatement: { VendorName: 'AWS', Name: name } },
          }),
        ),
      ],
    });
    const acls = Object.keys(template.findResources('AWS::WAFv2::WebACL'));
    expect(acls).toHaveLength(1);
    const stageIds = Object.keys(template.findResources('AWS::ApiGateway::Stage'));
    expect(stageIds).toHaveLength(1);
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    template.hasResourceProperties('AWS::WAFv2::WebACLAssociation', {
      WebACLArn: { 'Fn::GetAtt': [acls[0], 'Arn'] },
      ResourceArn: Match.anyValue(),
    });
    const associations = Object.values(template.findResources('AWS::WAFv2::WebACLAssociation'));
    expect(associations[0]?.['DependsOn']).toContain(stageIds[0]);
    expect(JSON.stringify(associations[0]?.['Properties']['ResourceArn'])).toContain('/stages/');
    expect(JSON.stringify(associations[0]?.['Properties']['ResourceArn'])).toContain(stageIds[0]);
  });
});

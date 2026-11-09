import type { APIGatewayProxyEvent } from 'aws-lambda';

export function restEvent(path: string, proxy = false): APIGatewayProxyEvent {
  const segments = path.split('/').filter(Boolean);
  const resource =
    segments.length > 1
      ? proxy
        ? `/${segments[0]}/{proxy+}`
        : `/${segments[0]}/{${segments[0] === 'orders' ? 'orderId' : 'productId'}}`
      : path;
  return {
    resource,
    path,
    httpMethod: 'GET',
    headers: { Host: 'example.execute-api.us-east-1.amazonaws.com' },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: proxy && segments.length > 1 ? { proxy: segments.slice(1).join('/') } : null,
    stageVariables: null,
    body: null,
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'example',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      path: `/prod${path}`,
      stage: 'prod',
      requestId: 'test-request',
      requestTimeEpoch: 0,
      resourceId: 'test-resource',
      resourcePath: resource,
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test',
        userArn: null,
      },
    },
  };
}

import type { APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';

export function handler(_event: APIGatewayProxyEvent): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ status: 'ok' }),
  };
}

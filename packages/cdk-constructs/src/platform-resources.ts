import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import type { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import { UserPool } from 'aws-cdk-lib/aws-cognito';
import type { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import type { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

import { platformParameterNames } from './platform-parameters.js';
import type { PlatformEnv } from './platform-parameters.js';

/** The shared Cognito user pool, imported from the values in SSM. */
export type PlatformUserPool = {
  /** The one Cognito user pool. A project adds its own app client to it. */
  readonly userPool: IUserPool;
  /** The host name of the hosted sign-in domain, without a scheme. A deploy-time value. */
  readonly domainName: string;
};

/**
 * Reads one platform value from SSM. The value resolves at deploy time
 * (`StringParameter.valueForStringParameter`), so synth needs no AWS account lookup and no
 * `cdk.context.json`.
 *
 * @param scope - The stack (or construct) that uses the value.
 * @param parameterName - The SSM parameter name.
 * @returns A token for the value.
 */
function readValue(scope: Construct, parameterName: string): string {
  return StringParameter.valueForStringParameter(scope, parameterName);
}

/**
 * Reads the Cognito parameters of the platform and imports the user pool. It reads only the
 * Cognito names, so a project without a domain never reads a name that does not exist.
 * It adds the child construct `PlatformUserPool` to `scope`. Call it one time for each scope.
 *
 * @param scope - The stack (or construct) that uses the user pool.
 * @param env - The environment whose `/platform/<env>/cognito/...` parameters to read.
 * @returns The imported user pool and the hosted sign-in domain name.
 */
export function readPlatformUserPool(scope: Construct, env: PlatformEnv): PlatformUserPool {
  const names = platformParameterNames(env);
  const holder = new Construct(scope, 'PlatformUserPool');

  return {
    userPool: UserPool.fromUserPoolArn(holder, 'UserPool', readValue(scope, names.userPoolArn)),
    domainName: readValue(scope, names.userPoolDomain),
  };
}

/**
 * Reads the DNS parameters of the platform and imports the hosted zone. Only call it after the
 * platform writes them. Today no zone exists, so the parameters are not there and a deploy fails.
 * It adds the child construct `PlatformDns` to `scope`. Call it one time for each scope.
 *
 * @param scope - The stack (or construct) that uses the zone.
 * @param env - The environment whose `/platform/<env>/dns/...` parameters to read.
 * @returns The imported hosted zone.
 */
export function readPlatformDns(scope: Construct, env: PlatformEnv): IHostedZone {
  const names = platformParameterNames(env);
  const holder = new Construct(scope, 'PlatformDns');

  return HostedZone.fromHostedZoneAttributes(holder, 'HostedZone', {
    hostedZoneId: readValue(scope, names.hostedZoneId),
    zoneName: readValue(scope, names.zoneName),
  });
}

/**
 * Reads the ACM parameter of the platform and imports the wildcard certificate. Only call it after
 * the platform writes it. Today no certificate exists, so the parameter is not there and a deploy
 * fails. It adds the child construct `PlatformCertificate` to `scope`. Call it one time for each
 * scope.
 *
 * @param scope - The stack (or construct) that uses the certificate.
 * @param env - The environment whose `/platform/<env>/acm/...` parameter to read.
 * @returns The imported wildcard certificate (region `us-east-1`).
 */
export function readPlatformCertificate(scope: Construct, env: PlatformEnv): ICertificate {
  const names = platformParameterNames(env);
  const holder = new Construct(scope, 'PlatformCertificate');

  return Certificate.fromCertificateArn(
    holder,
    'WildcardCertificate',
    readValue(scope, names.wildcardCertificateArn),
  );
}

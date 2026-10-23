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

/** The shared platform resources, imported from the values in SSM. */
export type PlatformResources = {
  /** The one Cognito user pool. A project adds its own app client to it. */
  readonly userPool: IUserPool;
  /** The imported Route53 hosted zone. A project adds its own records to it. */
  readonly hostedZone: IHostedZone;
  /** The ACM wildcard certificate for the zone (region `us-east-1`). */
  readonly wildcardCertificate: ICertificate;
};

/**
 * Reads the platform values from SSM and imports the shared resources.
 * The values resolve at deploy time (`StringParameter.valueForStringParameter`), so synth needs
 * no AWS account lookup and no `cdk.context.json`. It adds the child construct
 * `PlatformResources` to `scope`. Call it one time for each scope.
 *
 * @param scope - The stack (or construct) that uses the resources.
 * @param env - The environment whose `/platform/<env>/...` parameters to read.
 * @returns The imported user pool, hosted zone and wildcard certificate.
 */
export function readPlatformResources(scope: Construct, env: PlatformEnv): PlatformResources {
  const names = platformParameterNames(env);
  const holder = new Construct(scope, 'PlatformResources');

  const userPool = UserPool.fromUserPoolArn(
    holder,
    'UserPool',
    StringParameter.valueForStringParameter(scope, names.userPoolArn),
  );
  const hostedZone = HostedZone.fromHostedZoneAttributes(holder, 'HostedZone', {
    hostedZoneId: StringParameter.valueForStringParameter(scope, names.hostedZoneId),
    zoneName: StringParameter.valueForStringParameter(scope, names.zoneName),
  });
  const wildcardCertificate = Certificate.fromCertificateArn(
    holder,
    'WildcardCertificate',
    StringParameter.valueForStringParameter(scope, names.wildcardCertificateArn),
  );

  return { userPool, hostedZone, wildcardCertificate };
}

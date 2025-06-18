import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class NestjsCdkProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Step 1: Create a VPC
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // Step 2: Create a security group for DB
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DBSecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'Allow Lambda to connect to RDS',
    });

    // Step 3: Add ingress rule for PostgreSQL
    dbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'Allow PostgreSQL access');

    // Step 4: Create DB credentials secret
    const dbCredentialsSecret = new rds.DatabaseSecret(this, 'DbCredentialsSecret', {
      username: 'postgres',
    });

    // Step 5: Create the RDS instance
    const dbInstance = new rds.DatabaseInstance(this, 'PostgresInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      multiAz: false,
      publiclyAccessible: false,
      databaseName: 'nestjsdb',
    });

    // ✅ Step 6: Now update your Lambda like this:
    const lambdaFunction = new NodejsFunction(this, 'LambdaFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(process.cwd(), 'nodejs-aws-cart-api/src/main.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        nodeModules: [
          'serverless-http',
          'class-transformer',
          'class-validator',
          '@nestjs/microservices',
          '@nestjs/websockets',
        ],
      },
      vpc,
      securityGroups: [dbSecurityGroup],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        NODE_ENV: 'production',
        DB_HOST: dbInstance.dbInstanceEndpointAddress,
        DB_PORT: dbInstance.dbInstanceEndpointPort,
        DB_NAME: 'nestjsdb',
        DB_USER: 'postgres',
        DB_SECRET_ARN: dbCredentialsSecret.secretArn,
      },
    });

    // Step 7: API Gateway integration (optional)
    const api = new apigateway.RestApi(this, 'NestApi', {
      restApiName: 'Nest Service',
    });
    api.root.addMethod('ANY', new apigateway.LambdaIntegration(lambdaFunction));

     lambdaFunction.addEnvironment('DB_HOST', dbInstance.dbInstanceEndpointAddress);
    lambdaFunction.addEnvironment('DB_PORT', '5432');
    lambdaFunction.addEnvironment('DB_USER', 'postgres');
    lambdaFunction.addEnvironment('DB_PASSWORD', 'password'); 
    lambdaFunction.addEnvironment('DB_NAME', 'nestjsdb');
  }
}

import {
  CfnOutput,
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
} from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib/core";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as eventsources from "aws-cdk-lib/aws-lambda-event-sources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as ses from "aws-cdk-lib/aws-ses";
import * as customResources from "aws-cdk-lib/custom-resources";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as crypto from 'crypto';

import path = require("path");

const configParams = require("../config.params.json");

export class CdkBackendStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Input Parameters
    const sqsVisibilityTimeout = configParams["SqsVisibilityTimeout"];
    const sesConfigSetName = configParams["sesConfigSetName"];
    const createSMSConfigSet = configParams["createSMSConfigSet"];
    const smsConfigSetName = configParams["smsConfigSetName"];

    // DynamoDB table for Message status
    const messageTable = new dynamodb.Table(this, "MessageTable", {
      partitionKey: { name: "messageId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });

    // DynamoDB table for WhatsApp message id mapping
    const whatsappMappingTable = new dynamodb.Table(this, "WhatsAppMappingTable", {
      partitionKey: { name: "whatsapp_msg_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // SQS Queues
    const dlq = new sqs.Queue(this, "DLQ");
    const primaryQueue = new sqs.Queue(this, "PrimaryQueue", {
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 5,
      },
    });
    const fallbackQueue = new sqs.Queue(this, "FallbackQueue", {
      visibilityTimeout: Duration.seconds(sqsVisibilityTimeout),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 5,
      },
    });

    primaryQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["sqs:*"],
        resources: [primaryQueue.queueArn],
        conditions: {
          Bool: { "aws:SecureTransport": "false" },
        },
      })
    );

    fallbackQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["sqs:*"],
        resources: [fallbackQueue.queueArn],
        conditions: {
          Bool: { "aws:SecureTransport": "false" },
        },
      })
    );

    dlq.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["sqs:*"],
        resources: [dlq.queueArn],
        conditions: {
          Bool: { "aws:SecureTransport": "false" },
        },
      })
    );

    // SNS Topic
    const kmsKey = new kms.Key(this, "SnsTopicKey", {
      enableKeyRotation: true,
    });

    kmsKey.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt", "kms:GenerateDataKey"],
        principals: [
          new iam.ServicePrincipal("ses.amazonaws.com"),
          new iam.ServicePrincipal("sms-voice.amazonaws.com"),
          new iam.ServicePrincipal("social-messaging.amazonaws.com"),
        ],
        resources: ["*"],
      })
    );

    const snsTopic = new sns.Topic(this, "EUMEventsTopic", {
      topicName: "EUMEvents",
      masterKey: kmsKey,
    });

    // API Gateway
    const logGroup = new logs.LogGroup(this, "ApiGatewayLogs");

    const api = new apigateway.RestApi(this, "FallbackMessagingApi", {
      restApiName: "Fallback Messaging Service",
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    const messages = api.root.addResource("messages");

    const generateRandomApiKey = (length: number) => {
      return crypto.randomBytes(length).toString('base64').slice(0, length).replace(/\+/g, '0').replace(/\//g, '0');
    };
    const randomApiKeyValue = generateRandomApiKey(20);

    const apiKey = api.addApiKey("ApiKey", {
      value: randomApiKeyValue
    });

    const usagePlan = api.addUsagePlan("UsagePlan", {
      name: "FallbackMessagingUsagePlan",
      throttle: {
        rateLimit: 100,
        burstLimit: 200
      }
    });

    usagePlan.addApiKey(apiKey);

    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });

    // SQS Integration for API Gateway
    const sendMessageIntegration = new apigateway.AwsIntegration({
      service: "sqs",
      path: `${primaryQueue.queueName}`,
      integrationHttpMethod: "POST",
      options: {
        credentialsRole: new iam.Role(this, "ApiGatewaySqsRole", {
          assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
          inlinePolicies: {
            allowSqsSendMessage: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  actions: ["sqs:SendMessage"],
                  effect: iam.Effect.ALLOW,
                  resources: [primaryQueue.queueArn],
                }),
              ],
            }),
          },
        }),
        requestParameters: {
          "integration.request.header.Content-Type":
            "'application/x-www-form-urlencoded'",
        },
        requestTemplates: {
          "application/json":
            "Action=SendMessage&MessageBody=$util.escapeJavaScript($input.body)",
        },
        integrationResponses: [
          {
            statusCode: "200",
            responseTemplates: {
              "application/json": JSON.stringify({
                message: "Message sent to the queue",
              }),
            },
          },
        ],
      },
    });

    messages.addMethod("POST", sendMessageIntegration, {
      apiKeyRequired: true,
      methodResponses: [{ statusCode: "200" }],
      requestValidatorOptions: {
        validateRequestBody: true,
        validateRequestParameters: true,
      },
    });

    // CDK Nag suppressions for API Gateway
    NagSuppressions.addResourceSuppressions(
      api,
      [
        {
          id: "AwsSolutions-APIG4",
          reason:
            "Authorization is not required for this API in the current context.",
        },
        {
          id: "AwsSolutions-COG4",
          reason:
            "Cognito authorization is not needed for this specific API method.",
        },
      ],
      true
    );

    // Primary Message Handler Lambda
    const primaryHandlerLambda = new lambda.Function(
      this,
      "PrimaryHandlerLambda",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lib/lambdas/PrimaryHandlerLambda"),
        handler: "index.lambda_handler",
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          PRIMARY_QUEUE_URL: primaryQueue.queueUrl,
          FALLBACK_QUEUE_URL: fallbackQueue.queueUrl,
          DYNAMODB_TABLE_NAME: messageTable.tableName,
          SNS_TOPIC_ARN: snsTopic.topicArn
        },
      }
    );

    // Secondary Message Handler Lambda
    const secondaryHandlerLambda = new lambda.Function(
      this,
      "SecondaryHandlerLambda",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lib/lambdas/SecondaryHandlerLambda"),
        handler: "index.lambda_handler",
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          DYNAMODB_TABLE_NAME: messageTable.tableName,
        },
      }
    );

    // Email Event Processor Lambda
    const emailEventProcessorLambda = new lambda.Function(
      this,
      "EmailEventProcessorLambda",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lib/lambdas/EmailEventProcessorLambda"),
        handler: "index.lambda_handler",
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          DYNAMODB_TABLE_NAME: messageTable.tableName,
        },
      }
    );

    // SMS Event Processor Lambda
    const smsEventProcessorLambda = new lambda.Function(
      this,
      "SMSEventProcessorLambda",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lib/lambdas/SMSEventProcessorLambda"),
        handler: "index.lambda_handler",
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          DYNAMODB_TABLE_NAME: messageTable.tableName,
        },
      }
    );

    // WhatsApp Event Processor Lambda
    const whatsappEventProcessorLambda = new lambda.Function(
      this,
      "WhatsAppEventProcessorLambda",
      {
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lib/lambdas/WhatsAppEventProcessorLambda"),
        handler: "index.lambda_handler",
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          DYNAMODB_TABLE_NAME: messageTable.tableName,
          WHATSAPP_MAPPING: whatsappMappingTable.tableName,
        },
      }
    );

    // Grant KMS Decrypt permissions to Lambda
    kmsKey.grantDecrypt(primaryHandlerLambda);
    kmsKey.grantDecrypt(secondaryHandlerLambda);
    kmsKey.grantDecrypt(emailEventProcessorLambda);
    kmsKey.grantDecrypt(smsEventProcessorLambda);
    kmsKey.grantDecrypt(whatsappEventProcessorLambda);

    // Grant DynamoDB and SQS permissions for primaryHandlerLambda
    //messageTable.grantReadWriteData(primaryHandlerLambda);
    //fallbackQueue.grantSendMessages(primaryHandlerLambda);

    primaryHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "kms:Decrypt",
          "ses:SendEmail",
          "ses:SendTemplatedEmail",
          "sms-voice:SendTextMessage",
          "social-messaging:SendWhatsAppMessage"
        ],
        effect: iam.Effect.ALLOW,
        resources: ["*"],
      })
    );

    primaryHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "sqs:SendMessage",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
        ],
        effect: iam.Effect.ALLOW,
        resources: [messageTable.tableArn, fallbackQueue.queueArn],
      })
    );

    // Grant DynamoDB and SQS permissions for secondaryHandlerLambda
    //messageTable.grantReadWriteData(secondaryHandlerLambda);
    //fallbackQueue.grantConsumeMessages(secondaryHandlerLambda);

    secondaryHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "kms:Decrypt",
          "ses:SendEmail",
          "ses:SendTemplatedEmail",
          "sms-voice:SendTextMessage",
          "social-messaging:SendWhatsAppMessage"
        ],
        effect: iam.Effect.ALLOW,
        resources: ["*"],
      })
    );

    secondaryHandlerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
        ],
        effect: iam.Effect.ALLOW,
        resources: [messageTable.tableArn, fallbackQueue.queueArn, whatsappMappingTable.tableArn],
      })
    );

    // Grant DynamoDB permission for Email, SMS and WhatsApp eventProcessorLambdas
    //messageTable.grantReadWriteData(emailEventProcessorLambda);
    //messageTable.grantReadWriteData(smsEventProcessorLambda);
    //messageTable.grantReadWriteData(whatsappEventProcessorLambda);
    //whatsappMappingTable.grantReadWriteData(whatsappEventProcessorLambda);

    emailEventProcessorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        effect: iam.Effect.ALLOW,
        resources: [messageTable.tableArn, fallbackQueue.queueArn],
      })
    );

    smsEventProcessorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        effect: iam.Effect.ALLOW,
        resources: [messageTable.tableArn, fallbackQueue.queueArn],
      })
    );

    whatsappEventProcessorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:PutItem"],
        effect: iam.Effect.ALLOW,
        resources: [messageTable.tableArn, whatsappMappingTable.tableArn, fallbackQueue.queueArn],
      })
    );

    // Subscribe Email, SMS and WhatsApp processor Lambdas to SNS
    snsTopic.addSubscription(
      new subscriptions.LambdaSubscription(smsEventProcessorLambda, {
        filterPolicyWithMessageBody: {
          context: sns.FilterOrPolicy.policy({
            message_type: sns.FilterOrPolicy.filter(
              sns.SubscriptionFilter.stringFilter({
                allowlist: ["primary"],
              })
            ),
          }),
        },
      })
    );

    snsTopic.addSubscription(
      new subscriptions.LambdaSubscription(emailEventProcessorLambda, {
        filterPolicyWithMessageBody: {
          mail: sns.FilterOrPolicy.policy({
            tags: sns.FilterOrPolicy.policy({
              message_type: sns.FilterOrPolicy.filter(
                sns.SubscriptionFilter.stringFilter({
                  allowlist: ["primary"],
                })
              ),
            }),
          }),
        },
      })
    );

    snsTopic.addSubscription(
      new subscriptions.LambdaSubscription(whatsappEventProcessorLambda, {
        filterPolicyWithMessageBody: {
          whatsAppWebhookEntry: sns.FilterOrPolicy.filter(
            sns.SubscriptionFilter.existsFilter()
          ),
        },
      })
    );

    // Add Lambda triggers for the SQS queues
    primaryHandlerLambda.addEventSource(
      new eventsources.SqsEventSource(primaryQueue)
    );
    secondaryHandlerLambda.addEventSource(
      new eventsources.SqsEventSource(fallbackQueue)
    );

    /**************************************************************************************************************
     * Email Backend *
     **************************************************************************************************************/
    let configSet;
    const createSESConfigSet = configParams.createSESConfigSet;

    if (createSESConfigSet == "true") {
      configSet = new ses.ConfigurationSet(this, "MyConfigSet", {
        configurationSetName: sesConfigSetName,
      });

      configSet.addEventDestination("EUMEventDestination", {
        events: [
          ses.EmailSendingEvent.SEND,
          ses.EmailSendingEvent.RENDERING_FAILURE,
          ses.EmailSendingEvent.REJECT,
          ses.EmailSendingEvent.DELIVERY,
          ses.EmailSendingEvent.BOUNCE,
          ses.EmailSendingEvent.COMPLAINT,
        ],
        destination: ses.EventDestination.snsTopic(snsTopic),
      });
    }

    // Allow SES to publish events on SNS topic
    snsTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal("ses.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [snsTopic.topicArn],
      })
    );

    /**************************************************************************************************************
     * SMS Backend *
     **************************************************************************************************************/
    // SMS Infra Lambda
    const SMSInfraLambda = new lambda.Function(this, "SMSInfraLambda", {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lib/lambdas/EUMInfraLambda"),
      handler: "index.lambda_handler",
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        SMS_CONFIG_SET_NAME: smsConfigSetName,
        CREATE_SMS_CONFIG_SET: createSMSConfigSet,
        SNS_TOPIC_ARN: snsTopic.topicArn,
      },
    });

    SMSInfraLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "sms-voice:TagResource",
          "sms-voice:CreateConfigurationSet",
          "sms-voice:CreateEventDestination",
        ],
        effect: iam.Effect.ALLOW,
        resources: ["*"],
      })
    );

    // Define the custom resource provider
    const lambdaTriggerProvider = new customResources.Provider(
      this,
      "LambdaTriggerProvider",
      {
        onEventHandler: SMSInfraLambda,
      }
    );

    // Custom resource to trigger the Lambda
    new cdk.CustomResource(this, "TriggerSMSInfraLambda", {
      serviceToken: lambdaTriggerProvider.serviceToken,
    });

    // Permission for sms-voice.amazonaws.com to publish events on SNS
    snsTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        principals: [new iam.ServicePrincipal("sms-voice.amazonaws.com")],
        resources: [snsTopic.topicArn],
        conditions: {
          StringEquals: {
            "AWS:SourceAccount": this.account,
          },
        },
      })
    );

    /**************************************************************************************************************
     * WhatsApp Backend *
     **************************************************************************************************************/

    // Allow End User Messaging Social to publish events on SNS topic
    snsTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ServicePrincipal("social-messaging.amazonaws.com"),
        ],
        actions: ["sns:Publish"],
        resources: [snsTopic.topicArn],
      })
    );

    /**************************************************************************************************************
     * CDK Outputs *
     **************************************************************************************************************/

    new cdk.CfnOutput(this, "ApiUrl", {
      value: `${api.url}messages`,
      description: "API Gateway URL with /messages endpoint",
    });

    new CfnOutput(this, "MessageTableName", {
      value: messageTable.tableName,
      description: "DynamoDB table name",
    });

    new cdk.CfnOutput(this, "ApiKeyValueOutput", {
      value: randomApiKeyValue,
      description: "The generated random value of the API Key",
      exportName: "FallbackMessagingApiKeyValue"
    });

    /**************************************************************************************************************
     * Nag Suppressions Outputs *
     **************************************************************************************************************/

    // Add suppressions for all Lambda functions
    const lambdaFunctions = [
      primaryHandlerLambda,
      emailEventProcessorLambda,
      smsEventProcessorLambda,
      secondaryHandlerLambda,
      SMSInfraLambda,
    ];

    lambdaFunctions.forEach((lambdaFunction) => {
      NagSuppressions.addResourceSuppressions(
        lambdaFunction,
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "Using AWS managed policy is acceptable for this Lambda function.",
          },
        ],
        true
      );
    });

    const lambdaSMSSESFunctions = [
      primaryHandlerLambda,
      secondaryHandlerLambda,
      SMSInfraLambda,
    ];
    lambdaSMSSESFunctions.forEach((lambdaFunction) => {
      NagSuppressions.addResourceSuppressions(
        lambdaFunction,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "SES and SMS actions require wildcard permissions. The Lambda function needs to send emails and SMS messages to various recipients.",
            appliesTo: ["Resource::*"],
          },
        ],
        true
      );
    });

    this.addNagSuppressions();
  }

  private addNagSuppressions() {
    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWS managed policies are acceptable for this solution. We are only using AWSLambdaBasicExecutionRole.",
      },
      {
        id: "AwsSolutions-IAM5",
        reason:
          "Wildcard permissions are required for certain Lambda functions and custom resources.",
      },
    ]);
  }
}
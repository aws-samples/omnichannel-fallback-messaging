import boto3
import json
import os

client = boto3.client("pinpoint-sms-voice-v2")


def lambda_handler(event, context):

    # Extract parameters from environment variables
    sms_config_set_name = os.getenv("SMS_CONFIG_SET_NAME")
    create_sms_config_set = os.getenv("CREATE_SMS_CONFIG_SET")
    sns_topic_arn = os.getenv("SNS_TOPIC_ARN")

    # Create a configuration set if CREATE_SMS_CONFIG_SET is true
    if create_sms_config_set == "true":
        create_config_set_response = client.create_configuration_set(
            ConfigurationSetName=sms_config_set_name,
        )

    # Create an event destination for the configuration set
    create_config_set_destination_response = client.create_event_destination(
        ConfigurationSetName=sms_config_set_name,
        EventDestinationName="SMSEventDestination",
        MatchingEventTypes=["ALL"],
        SnsDestination={"TopicArn": sns_topic_arn},
    )

    # Return the configuration set name in the response
    return {
        "statusCode": 200,
        "body": json.dumps({"config_set_name": sms_config_set_name}),
    }

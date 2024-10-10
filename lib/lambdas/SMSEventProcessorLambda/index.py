import json
import os
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ["DYNAMODB_TABLE_NAME"])


def lambda_handler(event, context):
    # Parse the event
    sms_event = json.loads(event["Records"][0]["Sns"]["Message"])

    # Check if the eventType is TEXT_SUCCESSFUL or TEXT_DELIVERED
    if sms_event["eventType"] in ["TEXT_SUCCESSFUL", "TEXT_DELIVERED"]:
        message_id = sms_event["messageId"]

        # Update DynamoDB
        try:
            response = table.update_item(
                Key={"messageId": message_id},
                UpdateExpression="SET #status = :status",
                ConditionExpression="attribute_exists(messageId)",
                ExpressionAttributeNames={"#status": "status"},
                ExpressionAttributeValues={":status": "delivered"},
            )
            return {
                "statusCode": 200,
                "body": json.dumps("DynamoDB updated successfully"),
            }
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                print(f"Item with messageId {message_id} does not exist")
                return {
                    "statusCode": 404,
                    "body": json.dumps("Item not found in DynamoDB"),
                }
            else:
                print(f"Error updating DynamoDB: {str(e)}")
                return {
                    "statusCode": 500,
                    "body": json.dumps("Error updating DynamoDB"),
                }

    return {
        "statusCode": 200,
        "body": json.dumps("Event processed (not a TEXT_SUCCESSFUL event)"),
    }

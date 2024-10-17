import json
import os
import boto3
import logging
from botocore.exceptions import ClientError

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource("dynamodb")
message_status_table = dynamodb.Table(os.environ["DYNAMODB_TABLE_NAME"])
whatsapp_mapping_table = dynamodb.Table(os.environ["WHATSAPP_MAPPING"])


def lambda_handler(event, context):
    logger.info("Received event: %s", json.dumps(event))

    try:
        whatsapp_event = json.loads(event["Records"][0]["Sns"]["Message"])
        logger.info("Parsed SNS Message: %s", whatsapp_event)
    except Exception as e:
        logger.error("Error parsing SNS Message: %s", str(e))
        return {
            "statusCode": 500,
            "body": json.dumps("Error parsing SNS Message.")
        }

    try:
        webhook_entry = json.loads(whatsapp_event["whatsAppWebhookEntry"])
        logger.info("Parsed WhatsApp Webhook Entry: %s", webhook_entry)
    except Exception as e:
        logger.error("Error parsing WhatsApp Webhook Entry: %s", str(e))
        return {
            "statusCode": 500,
            "body": json.dumps("Error parsing WhatsApp Webhook Entry.")
        }

    if "changes" in webhook_entry and webhook_entry["changes"][0]["field"] == "messages":
        statuses = webhook_entry["changes"][0]["value"].get("statuses", [])

        if statuses:
            status = statuses[0]["status"]
            whatsapp_msg_id = statuses[0].get("id")  # WhatsApp message ID may not be present
            logger.info("Processing status: %s for WhatsApp Message ID: %s", status, whatsapp_msg_id)

            if status == "accepted":
                aws_msg_id = whatsapp_event["messageId"]
                logger.info("AWS Message ID: %s", aws_msg_id)

                try:
                    # Query the message_status_table using aws_msg_id
                    response = message_status_table.get_item(Key={"messageId": aws_msg_id})
                    logger.info("DynamoDB GetItem response: %s", response)

                    if "Item" in response:
                        # Insert into the WHATSAPP_MAPPING table
                        whatsapp_mapping_table.put_item(
                            Item={
                                "whatsapp_msg_id": whatsapp_msg_id,
                                "aws_msg_id": aws_msg_id
                            }
                        )
                        logger.info("Mapping stored successfully: WhatsApp Msg ID: %s, AWS Msg ID: %s", whatsapp_msg_id, aws_msg_id)
                        return {
                            "statusCode": 200,
                            "body": json.dumps("Mapping stored successfully.")
                        }
                    else:
                        logger.warning("Item with aws_msg_id %s does not exist in message_status_table.", aws_msg_id)
                        return {
                            "statusCode": 404,
                            "body": json.dumps("Item not found in message_status_table.")
                        }

                except ClientError as e:
                    logger.error("Error querying DynamoDB: %s", str(e))
                    return {
                        "statusCode": 500,
                        "body": json.dumps("Error querying DynamoDB.")
                    }

            elif status == "delivered":
                try:
                    # Query the WHATSAPP_MAPPING table to get aws_msg_id using the whatsapp_msg_id
                    response = whatsapp_mapping_table.get_item(Key={"whatsapp_msg_id": whatsapp_msg_id})
                    logger.info("DynamoDB GetItem response from WHATSAPP_MAPPING: %s", response)

                    if "Item" in response:
                        aws_msg_id = response["Item"]["aws_msg_id"]
                        logger.info("Found AWS Message ID: %s for WhatsApp Message ID: %s", aws_msg_id, whatsapp_msg_id)

                        # Update the message_status_table with the new status
                        message_status_table.update_item(
                            Key={"messageId": aws_msg_id},
                            UpdateExpression="SET #status = :status",
                            ConditionExpression="attribute_exists(messageId)",
                            ExpressionAttributeNames={"#status": "status"},
                            ExpressionAttributeValues={":status": "delivered"},
                        )
                        logger.info("DynamoDB updated successfully. AWS Msg ID: %s, Status: delivered", aws_msg_id)
                        return {
                            "statusCode": 200,
                            "body": json.dumps("DynamoDB updated successfully. Status: delivered")
                        }
                    else:
                        logger.warning("Item with whatsapp_msg_id %s does not exist in whatsapp_mapping_table.", whatsapp_msg_id)
                        return {
                            "statusCode": 404,
                            "body": json.dumps("Item not found in whatsapp_mapping_table.")
                        }

                except ClientError as e:
                    logger.error("Error updating DynamoDB: %s", str(e))
                    return {
                        "statusCode": 500,
                        "body": json.dumps("Error updating DynamoDB.")
                    }

            elif status == "failed":
                aws_msg_id = whatsapp_event.get("messageId")
                if aws_msg_id:
                    logger.info("Failure status with AWS Message ID %s, no action required.", aws_msg_id)
                    return {
                        "statusCode": 200,
                        "body": json.dumps("Failure event, no action taken.")
                    }
                else:
                    logger.warning("Failure event without AWS message ID, no further action.")
                    return {
                        "statusCode": 200,
                        "body": json.dumps("Failure event with no AWS message ID, no action taken.")
                    }

    logger.info("No relevant status update required for event.")
    return {
        "statusCode": 200,
        "body": json.dumps("Event processed (no status update required).")
    }

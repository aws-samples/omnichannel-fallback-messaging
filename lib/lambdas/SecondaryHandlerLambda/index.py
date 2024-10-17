import json
import boto3
import os
from datetime import datetime
from send_email import send_email
from send_sms import send_sms
from send_whatsapp import send_whatsapp

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['DYNAMODB_TABLE_NAME'])

def lambda_handler(event, context):
    for record in event['Records']:
        # Parse the SQS message body
        body = json.loads(record['body'])
        
        message_id = body['messageId']
        channel = body['channel']
        sender = body['sender']
        recipient = body['recipient']
        send_body = body['send_body']
        
        # Check the delivery status in DynamoDB
        response = table.get_item(Key={'messageId': message_id})
        
        if 'Item' in response:
            item = response['Item']
            status = item.get('status')
            
            if status != 'delivered':
                # If not delivered, send the message using the fallback channel
                send_secondary_message(channel, sender, recipient, send_body)
                
                # Generate timestamp for when the fallback channel message was sent
                fc_message_sent_timestamp = datetime.utcnow().isoformat()
                
                # Update the status and timestamp in DynamoDB
                table.update_item(
                    Key={'messageId': message_id},
                    UpdateExpression='SET #status = :status, #fc_timestamp = :fc_timestamp',
                    ExpressionAttributeNames={
                        '#status': 'status',
                        '#fc_timestamp': 'fc_message_sent_timestamp'
                    },
                    ExpressionAttributeValues={
                        ':status': 'sent_fallback',
                        ':fc_timestamp': fc_message_sent_timestamp
                    }
                )
                
    return {
        'statusCode': 200,
        'body': json.dumps('Processed successfully')
    }

def send_secondary_message(channel, sender, recipient, send_body):
    if channel == "email":
        if "template" in send_body:
            
            email_message_body = {
                "template": send_body['template']
            }
            
            if 'configuration_set' in send_body:
                email_message_body['configuration_set'] = send_body['configuration_set']

            send_email(sender, recipient, email_message_body)
        else:
            email_message_body = {
                "subject": send_body.get('subject'),
                "text": send_body.get('text'),
                "html": send_body.get('html')
            }

            if 'configuration_set' in send_body:
                email_message_body['configuration_set'] = send_body['configuration_set']

            send_email(sender, recipient, email_message_body)

    elif channel == "sms":
        send_sms(sender, recipient, {
            "message": send_body['message'],
            "message_type": send_body['message_type'],
            "configuration_set": send_body['configuration_set']
        })
    elif channel == "whatsapp":
        send_whatsapp(sender, recipient, send_body)
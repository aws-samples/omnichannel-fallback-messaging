import json
import os
import boto3
from datetime import datetime
from send_email import send_email
from send_sms import send_sms
from send_whatsapp import send_whatsapp

sqs = boto3.client('sqs')
dynamodb = boto3.resource('dynamodb')

def lambda_handler(event, context):
    print(event)
    
    for record in event['Records']:
        body_str = record['body'].encode().decode('unicode_escape')
        body = json.loads(body_str)
        
        if body['use_case'] == "fallback":
            # Handle the primary channel
            pc = body['pc']
            channel_data = pc[pc['channel']]
            message_id = send_message(pc['channel'], pc['sender'], pc['recipient'], channel_data)
            
            # Generate timestamp for when the primary channel message was sent
            pc_message_sent_timestamp = datetime.utcnow().isoformat()

            # Store the message with additional attributes
            store_message(
                message_id=message_id, 
                recipient=pc['recipient'], 
                sender=pc['sender'], 
                send_body=channel_data, 
                channel=pc['channel'], 
                use_case=body['use_case'],
                fallback_channel=body['fc']['channel'],
                pc_message_sent_timestamp=pc_message_sent_timestamp,
                fallback_body=body['fc']
            )
            
            # Prepare and send the fallback information to the fallback queue with visibility timeout
            fc = body['fc']
            fallback_message_body = {
                'messageId': message_id,
                'channel': fc['channel'],
                'sender': fc['sender'],
                'recipient': fc['recipient'],
                'send_body': fc[fc['channel']]
            }
            
            if 'configuration_set' in fc['channel']:
                fallback_message_body['configuration_set'] = fc['channel']['configuration_set']

            sqs.send_message(
                QueueUrl=os.environ['FALLBACK_QUEUE_URL'],
                DelaySeconds=int(body['fallback_seconds']),
                MessageBody=json.dumps(fallback_message_body)
            )
        
        elif body['use_case'] == "broadcast":
            # Send to both primary and fallback channels without logging to DynamoDB
            pc = body['pc']
            fc = body['fc']
            
            # Send message to primary channel
            send_message(pc['channel'], pc['sender'], pc['recipient'], pc[pc['channel']])
            
            # Send message to fallback channel
            send_message(fc['channel'], fc['sender'], fc['recipient'], fc[fc['channel']])

    return {
        'statusCode': 200,
        'body': json.dumps({'message': 'Processed successfully'})
    }

def send_message(channel, sender, recipient, content):
    if channel == "email":
        if "template" in content:
            send_body = {
                "template": content['template']
            }
            if 'configuration_set' in content:
                send_body['configuration_set'] = content['configuration_set']
        else:
            send_body = {
                "subject": content.get('subject'),
                "text": content.get('text'),
                "html": content.get('html')
            } 
            if 'configuration_set' in content:
                send_body['configuration_set'] = content['configuration_set']                   
        return send_email(sender, recipient, send_body)
    elif channel == "sms":
        send_body = {
            "message": content['message'],
            "message_type": content['message_type'],
            "configuration_set": content['configuration_set']
        } 
        return send_sms(sender, recipient, send_body)
    elif channel == "whatsapp":
        send_body = {
            "message": content['message']
        }
        return send_whatsapp(sender, recipient, send_body)

def store_message(message_id, recipient, sender, send_body, channel, use_case, fallback_channel, pc_message_sent_timestamp, fallback_body):
    table = dynamodb.Table(os.environ['DYNAMODB_TABLE_NAME'])
    table.put_item(Item={
        'messageId': message_id,
        'recipient': recipient,
        'sender': sender,
        'message': str(send_body),
        'primary_channel': channel,
        'use_case': use_case,
        'status': 'sent',
        'fallback_channel': fallback_channel,
        'pc_message_sent_timestamp': pc_message_sent_timestamp,
        'fallback_body': fallback_body
    })
import boto3
client = boto3.client('pinpoint-sms-voice-v2')

def send_sms(sender, recipient, send_body):

    try:
        response = client.send_text_message(
            DestinationPhoneNumber=recipient,
            OriginationIdentity=sender,
            MessageBody=send_body['message'],
            MessageType=send_body['message_type'],
            ConfigurationSetName=send_body['configuration_set'],
            Context={
                'message_type': 'fallback'
            }
        )
        return response['MessageId']

    except Exception as e:
        print("Error sending message:", e)
        return None
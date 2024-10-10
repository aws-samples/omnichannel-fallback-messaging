import boto3
sesv2_client = boto3.client('sesv2')

def send_email(sender, recipient, send_body):
    try:
        if "template" in send_body:
            template_name = send_body['template']
            email_params = {
                'FromEmailAddress': sender,
                'Destination': {
                    'ToAddresses': [recipient],
                },
                'Content': {
                    'Template': {
                        'TemplateName': template_name,
                        'TemplateData': '{}'
                    }
                },
                 'EmailTags':[
                    {
                        'Name': 'message_type',
                        'Value': 'primary'
                    }
                ]
            }

            # Add configuration set if it's present in send_body
            if 'configuration_set' in send_body:
                email_params['ConfigurationSetName'] = send_body['configuration_set']

            response = sesv2_client.send_email(**email_params)
            return response['MessageId']

        else:
            subject = send_body['subject']
            body_text = send_body['text']
            body_html = send_body['html']

            email_params = {
                'FromEmailAddress': sender,
                'Destination': {
                    'ToAddresses': [recipient],
                },
                'Content': {
                    'Simple': {
                        'Subject': {
                            'Data': subject,
                            'Charset': 'UTF-8'
                        },
                        'Body': {
                            'Text': {
                                'Data': body_text,
                                'Charset': 'UTF-8'
                            },
                            'Html': {
                                'Data': body_html,
                                'Charset': 'UTF-8'
                            }
                        }
                    }
                },
                 'EmailTags':[
                    {
                        'Name': 'message_type',
                        'Value': 'primary'
                    }
                ]
            }

            # Add configuration set if it's present in send_body
            if 'configuration_set' in send_body:
                email_params['ConfigurationSetName'] = send_body['configuration_set']

            response = sesv2_client.send_email(**email_params)
            return response['MessageId']
    except Exception as e:
        print("Error sending email:", e)
        return None
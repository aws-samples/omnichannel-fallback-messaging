import boto3
import json

client = boto3.client("socialmessaging")

def send_whatsapp(origination_phone_number_id, recipient, send_body):
    try:

        # Construct the message following Meta API's format
        whatsapp_message = {
            "messaging_product": "whatsapp",
            "type": "text",
            "preview_url": True,
            "to": recipient,
            "text": {"body": send_body['message']},
            
        }

        # Convert the message to a JSON string and then to bytes (no Base64 encoding needed)
        message_json = json.dumps(whatsapp_message).encode('utf-8')

        response = client.send_whatsapp_message(
            originationPhoneNumberId=origination_phone_number_id,
            message=message_json,
            metaApiVersion="v20.0",
        )

        return response["messageId"]

    except client.exceptions.ValidationException as e:
        print("Validation Error:", e)
    except client.exceptions.AccessDeniedException as e:
        print("Access Denied:", e)
    except client.exceptions.ResourceNotFoundException as e:
        print("Resource Not Found:", e)
    except client.exceptions.InvalidParametersException as e:
        print("Invalid Parameters:", e)
    except client.exceptions.ThrottledRequestException as e:
        print("Request Throttled:", e)
    except client.exceptions.InternalServiceException as e:
        print("Internal Service Error:", e)
    except client.exceptions.DependencyException as e:
        print("Dependency Error:", e)
    except Exception as e:
        print("Error sending WhatsApp message:", e)

    return None

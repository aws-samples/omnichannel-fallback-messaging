# Omnichannel Fallback Solution

A repository for a Omni-channel Fallback solution that uses Amazon API Gateway, AWS Lambda, Amazon Simple Email Service (SES), and AWS End User Messaging.

## Solution info:

Users can send email, SMS or WhatsApp messages as the primary and secondary channels using the API Gateway endpoint. The payload specifies the primary and secondary channel as well as sender, receiver addresses, message and how much time (fallback_seconds) the solution will wait for a successful delivery before it sends the message using the secondary channel.

## Architecture

![ArchitectureDiagram](docs/ArchitectureDiagram.png)

### Prerequisites:

1. Have at least one verified SES sending identity and if you are in the SES sandbox, one verified email address for receiving.

### Send messages payload:

**IMPORTANT:** at the moment configuration set fields for both email and SMS aren't used.

Below you can find the API request body and explanation for each field:

```
{
    "use_case": "<fallback or broadcast>",
    "fallback_seconds":"<number of seconds until fallback channel>",
    "pc": {
        "channel": "<SMS/WhatsApp/Email>",
        "sender": "<phone pool/phone number/email>",
        "recipient":"<phone number or email>",
        "email": {
            "subject": "<email subject>",
            "text": "<text>",
            "html": "<html>",
            "template": "<SES template name>",
            "configuration_set": "<configuration set name>"
        },
        "sms": {
            "message": "<the SMS content>",
            "message_type": "<PROMOTIONAL/TRANSACTIONAL>",
            "configuration_set": "<configuration set name>"
        }
    },
    "fc": {
        "channel": "<SMS/WhatsApp/Email>",
        "sender": "<phone pool/phone number/email>",
        "recipient":"<phone number or email>",
        "email": {
            "subject": "<email subject>",
            "text": "<email body text>",
            "html": "<email body html>",
            "template": "<SES template name>",
            "configuration_set": "<configuration set name>"
        },
        "sms": {
            "message": "<the SMS content>",
            "message_type": "<PROMOTIONAL/TRANSACTIONAL>",
            "configuration_set": "<configuration set name>"
        }
    }
}
```

- **use_case (mandatory)**: This takes two values **fallback** or **broadcast**. Fallback will send the message using the primary channel and if there is no successful delivery event after the specified **fallback_seconds** period, it will send the message using the fallback channel. The blast option sends from both the primary and fallback channels at the same time.

- **fallback_seconds (optional)**: Specifies how many seconds the solution should wait for successful message delivery from the primary channel before sending the message using the fallback channel.

- **pc (mandatory)**: PC stands for primary channel and it is the first channel the solution uses to send the message. This object is required even if the **use_case** is **blast**.

  - **channel (mandatory)**: Takes one of the following three values: **SMS**, **WhatsApp**, or **Email**. Depending on the choice, the solution will use the respective API to send the message.
  - **sender (mandatory)**: The sender value depends on the channel. **SMS** takes the value of the originating identity or phone pool ID, **WhatsApp** takes the phone number, and **Email** takes the email address. When selecting SMS or WhatsApp, ensure the phone number is in E164 format: <+country_code><phone_number>. To retain the "+" symbol in URLs, replace it with "%2B". For example, "+44" should be encoded as "%2B44".
  - **recipient (mandatory)**: The recipient value depends on the channel. **SMS** and **WhatsApp** take the phone number, and **Email** takes a valid email address.

  - **email (optional)**: The email object contains fields specific to email communication.

    - **subject (mandatory for email)**: The subject line of the email.
    - **text (optional)**: The plain text version of the email body.
    - **html (optional)**: The HTML version of the email body.
    - **template (optional)**: The name of the SES (Simple Email Service) template to be used for the email.
    - **configuration_set (optional)**: The configuration set name for event tracking. It allows the user to specify the events they want to track (e.g., delivery, bounce, complaint) and where to send them. This is essential for fallback logic but optional here, as it can be set at a higher level in SES.

  - **sms (optional)**: The SMS object contains fields specific to SMS communication.
    - **message (mandatory for SMS)**: The content of the SMS.
    - **message_type (mandatory for SMS)**: The type of SMS message, which can be **PROMOTIONAL** or **TRANSACTIONAL**.
    - **configuration_set (mandatory)**: The configuration set name for event tracking. This field is critical for ensuring the solution can properly track delivery or failure events to decide whether to trigger the fallback channel.

- **fc (mandatory)**: FC stands for fallback channel and is used if the primary channel fails to deliver the message successfully after the specified **fallback_seconds** period. This object is required even if the **use_case** is **blast**. The structure of this object is the same as **pc**.

## Configuration Options

This project uses a `config.params.json` file to specify various configuration options. You can customize the following options according to your requirements:

### SES Configuration Options

1. **configSetName** (string): The name of the Amazon SES configuration set to be created. This configuration set will be used to monitor email sending events.

2. **createSESConfigSet** (boolean): A flag to control whether the Amazon SES configuration set should be created or not. Set this to `true` if you want to create the configuration set, or `false` to skip its creation.

If `createSESConfigSet` is set to `true`, the project will create an Amazon SES configuration set with the name specified in `configSetName`. This configuration set will monitor the following email sending events:

- Send
- Rendering Failure
- Reject
- Delivery
- Hard Bounce
- Complaint
- Delivery Delay
- Subscription
- Open
- Click

These events will be published to an Amazon SNS topic named `EUMEvents`.

If `createSESConfigSet` is set to `false`, the Amazon SES configuration set and the associated event monitoring will not be created.

### SMS Configuration Options

1. **smsConfigSetName** (string): The name of the Amazon SMS configuration set to be created. This configuration set will be used to monitor SMS sending events.

2. **createSMSConfigSet** (boolean): A flag to control whether the Amazon SMS configuration set should be created or not. Set this to `true` if you want to create the configuration set, or `false` to skip its creation.

If `createSMSConfigSet** is set to `true`, the project will create an Amazon SMS configuration set with the name specified in `smsConfigSetName`. This configuration set will monitor the following SMS sending events:

- All SMS Events (Send, Delivery, Bounce, etc.)

These events will be published to the Amazon SNS topic specified in the environment variable `SNS_TOPIC_ARN`.

If `createSMSConfigSet` is set to `false`, the Amazon SMS configuration set and the associated event monitoring will not be created.

### General Notes

Make sure to update the `config.params.json` file with your desired configuration for both SES and SMS options before deploying the CDK stack.

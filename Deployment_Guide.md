# Deployment Guide

This guide walks you through deploying the project from the omnichannel-fallback-messaging repository. The project uses the AWS Cloud Development Kit (CDK) to define cloud infrastructure and deploy resources. The solution supports sending messages via Email, SMS, and WhatsApp, using a primary and fallback channel strategy.

### Prerequisites

1. **Node.js**: Ensure that Node.js (>=14.x) is installed on your machine. You can download it from [here](https://nodejs.org/).
2. **AWS CLI**: Install and configure the [AWS Command Line Interface](https://aws.amazon.com/cli/).
3. **AWS CDK**: Install the AWS CDK CLI by running the following command:
   ```bash
   npm install -g aws-cdk
   ```
4. **AWS Credentials**: Ensure your AWS credentials are configured using the AWS CLI. You can do this by running:
   ```bash
   aws configure
   ```
   You'll need to provide your AWS Access Key, Secret Key, and default region.
5. **Bootstrap your environment**: Before deploying any CDK applications, bootstrap your AWS environment:
   ```bash
   cdk bootstrap
   ```
6. **Setup Channels**: Ensure that you have at least two channels configured:
   - **Email (SES)**: Verify at least one sending identity and a recipient email if you're in the SES sandbox.
   - **SMS (AWS End User Messaging)**: Use the **AWS End User Messaging (EUM)** service for sending SMS, and configure the SMS simulator for testing.
   - **WhatsApp (AWS End User Messaging)**: Ensure you have set up AWS End User Messaging with a valid WhatsApp number. There is no simulator for WhatsApp, so test using real credentials.

### Step-by-Step Deployment

1. **Clone the Repository**  
   First, clone the repository to your local machine:
   ```bash
   git clone https://github.com/aws-samples/omnichannel-fallback-messaging
   cd repo_all
   ```

2. **Install Dependencies**  
   Install the necessary Node.js dependencies by running:
   ```bash
   npm install
   ```

3. **Configure Parameters**  
   The `config.params.json` file contains important configuration parameters that you can customize based on your environment. Below are the parameters and their purposes:

   #### Parameters in `config.params.json`

   - **CdkBackendStack**: Specifies the name of the CloudFormation stack created by the AWS CDK.
     - Default Value: `"FallbackMessagingService"`
   
   - **SqsVisibilityTimeout**: Defines the visibility timeout (in seconds) for messages in the SQS queue. 
     - Default Value: `300` (5 minutes)
   
   - **sesConfigSetName**: Name of the SES configuration set.
     - Default Value: `"ses-config-set"`
   
   - **createSESConfigSet**: Determines whether to create an SES configuration set during deployment.
     - Default Value: `"true"`
   
   - **smsConfigSetName**: Name of the SMS configuration set for Amazon SNS.
     - Default Value: `"sms-config-set"`
   
   - **createSMSConfigSet**: Determines whether to create an SMS configuration set.
     - Default Value: `"true"`
   
   - **tags**: Tags for AWS resources (e.g., `"Application"`, `"Environment"`, `"Owner"`, `"Project"`).
     - Action: Update the values to match your environment.

4. **Build the CDK Stack**  
   Compile the TypeScript code to JavaScript by running:
   ```bash
   npm run build
   ```

5. **Deploy the CDK Stack**  
   Use the AWS CDK CLI to deploy the infrastructure to your AWS account:
   ```bash
   cdk deploy
   ```

6. **Verify Deployment**  
   After deployment, verify the resources in the AWS Console under the relevant services (Lambda, API Gateway, DynamoDB, etc.).

### Using the API

Once the infrastructure has been deployed, you can use the API to send messages across multiple channels (Email, SMS, and WhatsApp) with fallback logic. Below is an example request for sending a one-time password (OTP) for `Nutrition.co`, using WhatsApp as the primary channel and SMS as the fallback.

1. **API Endpoint**
   The API Gateway will provide an endpoint URL after deployment (CDK output). You can use this endpoint to send requests.

2. **Example Request Payload**

   Here’s an example payload for sending a 6-digit OTP using WhatsApp as the primary channel and SMS as the fallback channel:

   ```json
   {
     "use_case": "fallback",
     "fallback_seconds": "60",
     "pc": {
       "channel": "whatsapp",
       "sender": "<SENDER_WHATSAPP_NUMBER>",
       "recipient": "<RECIPIENT_WHATSAPP_NUMBER>",
       "whatsapp": {
         "message": "Your one-time password (OTP) for Nutrition.co is 123456."
       }
     },
     "fc": {
       "channel": "sms",
       "sender": "<SENDER_PHONE_NUMBER>",
       "recipient": "<RECIPIENT_PHONE_NUMBER>",
       "sms": {
         "message": "Your one-time password (OTP) for Nutrition.co is 123456.",
         "message_type": "TRANSACTIONAL",
         "configuration_set": "<SMS_CONFIGURATION_SET>"
       }
     }
   }
   ```

   **Explanation of Fields**:
   - **use_case**: Specifies the use case. In this case, it is set to `"fallback"` to use the fallback channel if the primary channel fails.
   - **fallback_seconds**: The number of seconds the system will wait for a successful delivery from the primary channel before attempting to send via the fallback channel.
   - **pc (Primary Channel)**:
     - **channel**: The primary communication channel, set to `"whatsapp"`.
     - **sender**: The WhatsApp sender phone number.
     - **recipient**: The WhatsApp recipient phone number.
     - **whatsapp.message**: The content of the WhatsApp message.
   - **fc (Fallback Channel)**:
     - **channel**: The fallback communication channel, set to `"sms"`.
     - **sender**: The SMS sender phone number.
     - **recipient**: The SMS recipient phone number.
     - **sms.message**: The content of the SMS message.
     - **sms.message_type**: The type of SMS message. Set this to `"TRANSACTIONAL"` for OTP messages.
     - **sms.configuration_set**: The SMS configuration set name for tracking.

3. **Testing the API**
   - Use tools like Postman or Curl to send a POST request to the API Gateway endpoint, with the above JSON payload.
   - For testing SMS and Email, you can either procure a phone number, verify a domain or use the [Amazon SES](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html) and [AWS End User Messaging SMS](https://docs.aws.amazon.com/sms-voice/latest/userguide/test-phone-numbers.html) simulators' addresses.
   - Follow the steps in this [guide](https://docs.aws.amazon.com/social-messaging/latest/userguide/setting-up.html) to setup WhatsApp.

### Additional Notes
- Ensure that the IAM roles and permissions are correctly set up for the Lambda functions.
- If you need to clean up the resources after testing, you can destroy the CDK stack:
   ```bash
   cdk destroy
   ```

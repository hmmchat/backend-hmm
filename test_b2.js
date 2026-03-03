import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: "/Users/kshitizmaurya/Documents/Projects/hmm/backend-hmm/apps/files-service/.env" });

const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME;
const endpoint = process.env.R2_ENDPOINT;
const region = process.env.R2_REGION || "us-east-005";

async function testUpload() {
    console.log("Config:", { accessKeyId, bucketName, endpoint, region });

    const s3Client = new S3Client({
        region,
        credentials: {
            accessKeyId,
            secretAccessKey
        },
        endpoint
    });

    try {
        const key = `test-${Date.now()}.txt`;
        console.log(`Uploading ${key}...`);

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: "Hello B2!",
            ContentType: "text/plain"
        });

        const result = await s3Client.send(command);
        console.log("✅ Upload success:", result);
    } catch (err) {
        console.error("❌ Upload failed:", err);
    }
}

testUpload();

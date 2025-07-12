export function getS3AudioUrl(filename: string, library?: string): string {
  let path = filename;
  if (library && !filename.includes("/")) {
    path = `${library.toLowerCase()}/${filename}`;
  }

  const bucketName = process.env.NEXT_PUBLIC_S3_BUCKET_NAME || "ananda-chatbot";
  const region = process.env.NEXT_PUBLIC_S3_REGION || "us-west-1";

  // Split the path into segments and encode each separately to preserve forward slashes
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://${bucketName}.s3.${region}.amazonaws.com/public/audio/${encodedPath}`;
}

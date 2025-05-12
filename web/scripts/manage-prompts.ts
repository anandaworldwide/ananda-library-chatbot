import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { loadEnv } from '../src/utils/server/loadEnv.js';
import fs from 'fs/promises';
import path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STAGING_DIR = path.join(__dirname, '.prompts-staging');
const LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const WEB_DIR = path.join(__dirname, '..');

// Helper to directly load environment from project root
function loadEnvironmentDirectly(site: string) {
  const projectRoot = path.join(__dirname, '..', '..');
  const envFile = path.join(projectRoot, `.env.${site}`);
  const result = dotenv.config({ path: envFile });
  if (result.error) {
    console.error(`Error loading env file: ${result.error}`);
  }
}

interface LockInfo {
  user: string;
  timestamp: number;
}

function createS3Client() {
  const region = process.env.AWS_REGION || 'us-west-1';
  return new S3Client({
    region,
    endpoint: `https://s3.${region}.amazonaws.com`,
    forcePathStyle: false,
  });
}

let s3Client: S3Client;

async function initS3Client() {
  // Initialize after env vars are loaded
  s3Client = createS3Client();
}

async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

async function ensureStagingDir() {
  try {
    await fs.mkdir(STAGING_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create staging directory:', error);
    process.exit(1);
  }
}

async function acquireLock(bucket: string, key: string): Promise<boolean> {
  const lockKey = `${key}.lock`;
  try {
    // Check if lock exists and is still valid
    try {
      const existingLock = await s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: lockKey,
        }),
      );

      if (existingLock.Body) {
        const lockContent = await streamToString(existingLock.Body as Readable);
        const lockInfo: LockInfo = JSON.parse(lockContent);
        const lockAge = Date.now() - lockInfo.timestamp;

        if (lockAge < LOCK_TIMEOUT) {
          console.error(
            `File is locked by ${lockInfo.user} for another ${Math.round((LOCK_TIMEOUT - lockAge) / 1000)} seconds`,
          );
          return false;
        }
      }
    } catch (lockErr) {
      // Continue if no lock exists
    }

    // Create/update lock
    const username = process.env.USER || 'unknown';
    const lockContent = JSON.stringify({
      user: username,
      timestamp: Date.now(),
    });

    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: lockKey,
        Body: lockContent,
      }),
    );
    return true;
  } catch (error) {
    console.error('Failed to acquire lock:', error);
    return false;
  }
}

async function releaseLock(bucket: string, key: string) {
  const lockKey = `${key}.lock`;
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: lockKey,
        Body: JSON.stringify({ user: '', timestamp: 0 }),
      }),
    );
  } catch (error) {
    console.error('Failed to release lock:', error);
  }
}

async function pullPrompt(filename: string) {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    console.error('S3_BUCKET_NAME not configured');
    process.exit(1);
  }

  const key = `site-config/prompts/${filename}`;

  if (!(await acquireLock(bucket, key))) {
    process.exit(1);
  }

  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    const content = await streamToString(response.Body as Readable);
    const localPath = path.join(STAGING_DIR, filename);
    await fs.writeFile(localPath, content);
    console.log(`Downloaded ${filename} to ${localPath}`);
  } catch (error) {
    console.error('Failed to pull prompt:', error);
    await releaseLock(bucket, key);
    process.exit(1);
  }
}

async function pushPrompt(filename: string) {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    console.error('S3_BUCKET_NAME not configured');
    process.exit(1);
  }

  const key = `site-config/prompts/${filename}`;
  const localPath = path.join(STAGING_DIR, filename);

  try {
    const content = await fs.readFile(localPath, 'utf8');

    // Upload with versioning enabled
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: 'text/plain',
      }),
    );

    console.log(`Uploaded ${filename} to S3`);
    await releaseLock(bucket, key);
  } catch (error) {
    console.error('Failed to push prompt:', error);
    await releaseLock(bucket, key);
    process.exit(1);
  }
}

async function getPreferredEditor(): Promise<string> {
  // Try to find VS Code first
  try {
    await execAsync('code --version');
    return 'code -w'; // -w flag waits for the file to be closed
  } catch {
    // VS Code not found, try other editors
    const editor = process.env.EDITOR || 'vim';
    if (editor.includes('emacs')) {
      return `${editor} -nw`; // -nw forces terminal mode
    }
    return editor;
  }
}

async function editPrompt(filename: string) {
  const localPath = path.join(STAGING_DIR, filename);
  try {
    const editor = await getPreferredEditor();
    console.log(`Opening with editor: ${editor}`);
    await execAsync(`${editor} "${localPath}"`);
  } catch (error) {
    console.error('Failed to open editor:', error);
    console.error(
      '\nTry setting your preferred editor in EDITOR environment variable',
    );
    console.error(
      'For example: EDITOR=nano npm run prompt ananda-public edit ananda-public-base.txt',
    );
    process.exit(1);
  }
}

async function diffPrompt(filename: string) {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    console.error('S3_BUCKET_NAME not configured');
    process.exit(1);
  }

  const key = `site-config/prompts/${filename}`;
  const localPath = path.join(STAGING_DIR, filename);

  try {
    // Get S3 content
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    if (!response.Body) {
      throw new Error('Empty response body');
    }

    const s3Content = await streamToString(response.Body as Readable);
    const tempS3Path = path.join(STAGING_DIR, `${filename}.s3`);
    await fs.writeFile(tempS3Path, s3Content);

    // Run diff
    try {
      const { stdout } = await execAsync(`diff ${tempS3Path} ${localPath}`);
      console.log(stdout || 'No differences found');
    } catch (error) {
      // diff returns exit code 1 if files are different
      if (error && typeof error === 'object' && 'stdout' in error) {
        console.log(error.stdout);
      }
    }

    // Cleanup temp file
    await fs.unlink(tempS3Path);
  } catch (error) {
    console.error('Failed to diff prompt:', error);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2); // Remove node path and script path
  const site = args[0];
  const command = args[1];
  const filename = args[2];
  const skipTests = args.slice(3).includes('--skip-tests');

  if (!site) {
    console.error('Please provide a site name as the first argument.');
    console.error(
      'Usage: npm run prompt [site] [command] [filename] [--skip-tests]',
    );
    console.error('Example: npm run prompt ananda-public pull base.txt');
    console.error('Example: npm run prompt ananda-public push base.txt');
    console.error(
      'Example: npm run prompt ananda-public push base.txt --skip-tests',
    );
    process.exit(1);
  }

  if (!command) {
    console.error('Please provide a command (pull, push, edit, or diff).');
    process.exit(1);
  }

  if (!['pull', 'push', 'edit', 'diff'].includes(command)) {
    console.error(
      `Unknown command: ${command}. Use: pull, push, edit, or diff`,
    );
    process.exit(1);
  }

  if (!filename) {
    console.error('Please provide a filename as the third argument.');
    process.exit(1);
  }

  // Set SITE_ID for loadEnv
  process.env.SITE_ID = site;
  // Use our direct environment loader
  loadEnvironmentDirectly(site);
  await initS3Client();
  await ensureStagingDir();

  switch (command) {
    case 'pull':
      await pullPrompt(filename);
      break;
    case 'push':
      if (!skipTests) {
        try {
          console.log(
            '\nRunning prompt validation tests before push... (use --skip-tests to bypass)',
          );
          execSync(`npm run test:queries:${site}`, {
            stdio: 'inherit',
            cwd: WEB_DIR,
          });
          console.log('✅ Prompt tests passed. Proceeding with push...\n');
        } catch (error) {
          console.error('\n❌ Prompt validation tests failed. Aborting push.');
          process.exit(1);
        }
      } else {
        console.log(
          '\nSkipping prompt validation tests (--skip-tests provided).\n',
        );
      }
      await pushPrompt(filename);
      break;
    case 'edit':
      await pullPrompt(filename);
      await editPrompt(filename);
      break;
    case 'diff':
      await diffPrompt(filename);
      break;
  }
}

main().catch(console.error);

/**
 * Manages chatbot system prompts stored in AWS S3.
 *
 * Provides commands to securely pull, edit, diff, and push prompt files.
 * Key features include:
 * - Locking mechanism: Prevents concurrent modifications to the same prompt file.
 * - Local staging: Allows editing prompts locally before pushing.
 * - Safe push workflow (push -> test -> rollback):
 *   1. Backs up the current prompt from S3.
 *   2. Pushes the local staging version to S3.
 *   3. Runs validation tests against the newly pushed S3 version.
 *   4. If tests fail, automatically restores the backup from S3.
 *   5. If tests pass (or are skipped), the new version remains.
 * - Environment-specific configurations via .env files.
 */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import fs from 'fs/promises';
import path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Handle Ctrl+C (SIGINT)
process.on('SIGINT', () => {
  console.error('❌ Caught interrupt signal (Ctrl+C). Aborting...');
  // Use the standard exit code for SIGINT
  process.exit(130);
});

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
    console.error(`❌ Error loading env file: ${result.error}`);
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
    console.error('❌ Failed to create staging directory:', error);
    process.exit(1);
  }
}

async function acquireLock(bucket: string, key: string): Promise<boolean> {
  const lockKey = `${key}.lock`;
  const currentUsername = process.env.USER || 'unknown'; // Get current user

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

        // If lock is fresh AND held by a DIFFERENT user, then it's locked.
        if (lockAge < LOCK_TIMEOUT && lockInfo.user !== currentUsername) {
          console.error(
            `❌ File is locked by ${lockInfo.user} (not you, ${currentUsername}) for another ${Math.round((LOCK_TIMEOUT - lockAge) / 1000)} seconds`,
          );
          return false;
        } else if (
          lockAge < LOCK_TIMEOUT &&
          lockInfo.user === currentUsername
        ) {
          console.log(
            `ℹ️ Refreshing existing lock for user ${currentUsername}...`,
          );
          // Allow to proceed, the lock will be overwritten/timestamp updated
        }
        // If lock is stale or belongs to current user, proceed to acquire/refresh
      }
    } catch (lockErr) {
      // If GetObjectCommand fails (e.g. NoSuchKey), it means no lock exists. Continue.
      if (
        !(lockErr instanceof S3ServiceException && lockErr.name === 'NoSuchKey')
      ) {
        // For other errors, log and deny, as we can't be sure of lock state.
        console.error('❌ Error checking existing lock:', lockErr);
        return false;
      }
    }

    // Create/update lock for the current user
    const lockContent = JSON.stringify({
      user: currentUsername, // Use the determined current username
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
    console.error('❌ Failed to acquire lock:', error);
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
    console.error('❌ Failed to release lock:', error);
  }
}

async function pullPrompt(filename: string) {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) {
    console.error('❌ S3_BUCKET_NAME not configured');
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
    console.log(`✅ Downloaded ${filename} to ${localPath}`);
  } catch (error) {
    console.error('❌ Failed to pull prompt:', error);
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
    console.log(`ℹ️ Opening with editor: ${editor}`);
    await execAsync(`${editor} "${localPath}"`);
  } catch (error) {
    console.error('❌ Failed to open editor:', error);
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
    console.error('❌ S3_BUCKET_NAME not configured');
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
      console.log(stdout || '✅ No differences found');
    } catch (error) {
      // diff returns exit code 1 if files are different
      if (error && typeof error === 'object' && 'stdout' in error) {
        console.log(error.stdout);
      }
    }

    // Cleanup temp file
    await fs.unlink(tempS3Path);
  } catch (error) {
    console.error('❌ Failed to diff prompt:', error);
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
    console.error('❌ Please provide a site name as the first argument.');
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
    console.error('❌ Please provide a command (pull, push, edit, or diff).');
    process.exit(1);
  }

  if (!['pull', 'push', 'edit', 'diff'].includes(command)) {
    console.error(
      `❌ Unknown command: ${command}. Use: pull, push, edit, or diff`,
    );
    process.exit(1);
  }

  if (!filename) {
    console.error('❌ Please provide a filename as the third argument.');
    process.exit(1);
  }

  // Set SITE_ID for loadEnv
  process.env.SITE_ID = site;
  // Use our direct environment loader
  loadEnvironmentDirectly(site);
  await initS3Client();
  await ensureStagingDir();

  // Define the helper function within main to ensure scope access
  async function handlePushLogic(params: {
    filename: string;
    site: string;
    skipTests: boolean;
    bucket: string;
    key: string;
    localPath: string;
    backupPath: string;
  }) {
    const { filename, site, skipTests, bucket, key, localPath, backupPath } =
      params;
    let backupContent: string | null = null;
    let lockAcquired = false;

    try {
      // 1. Acquire lock
      console.log('ℹ️ Acquiring lock...');
      lockAcquired = await acquireLock(bucket, key);
      if (!lockAcquired) process.exit(1);
      console.log('✅ Lock acquired.');

      // 2. Backup S3
      console.log('ℹ️ Attempting to back up current S3 version...');
      try {
        const response = await s3Client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (response.Body) {
          backupContent = await streamToString(response.Body as Readable);
          await fs.writeFile(backupPath, backupContent);
          console.log(`✅ Created local backup: ${backupPath}`);
        } else {
          console.log('ℹ️ No existing file content on S3 to back up.');
        }
      } catch (error) {
        if (error instanceof S3ServiceException && error.name === 'NoSuchKey') {
          console.log('ℹ️ No existing file on S3 to back up (NoSuchKey).');
          backupContent = null;
        } else {
          console.error('❌ Failed to fetch current prompt for backup:', error);
          throw error;
        }
      }

      // 3. Push local staging to S3
      console.log(`ℹ️ Pushing ${filename} from ${localPath} to S3...`);
      const stagingContent = await fs.readFile(localPath, 'utf8');
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: stagingContent,
          ContentType: 'text/plain',
        }),
      );
      console.log(`✅ Successfully pushed ${filename} to S3.`);

      // 4. Run tests (if not skipped)
      if (!skipTests) {
        try {
          console.log(
            'ℹ️ Running prompt validation tests against the newly pushed prompt...',
          );
          // Use the 'site' variable passed explicitly to this function
          execSync(`npm run test:queries:${site}`, {
            stdio: 'inherit',
            cwd: WEB_DIR,
          });
          console.log('✅ Prompt tests passed.');
          if (backupContent !== null) {
            await fs.unlink(backupPath);
            console.log(`✅ Cleaned up local backup: ${backupPath}`);
          }
        } catch (testError) {
          // 5. Tests failed, restore backup
          console.error(
            '❌ Prompt validation tests failed. Restoring previous version from backup...',
          );
          if (backupContent !== null) {
            await s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: backupContent,
                ContentType: 'text/plain',
              }),
            );
            console.log(
              '✅ Successfully restored previous version from backup.',
            );
            await fs.unlink(backupPath);
            console.log(
              `✅ Cleaned up local backup after restore: ${backupPath}`,
            );
          } else {
            console.warn('⚠️ No backup content found to restore.');
            console.log(
              'ℹ️ Attempting to delete the newly pushed file ${key} as rollback...',
            );
            try {
              await s3Client.send(
                new DeleteObjectCommand({ Bucket: bucket, Key: key }),
              );
              console.log('✅ Successfully deleted ${key} from S3.');
            } catch (deleteError) {
              console.error(
                '❌ Failed to delete ${key} during rollback:',
                deleteError,
              );
            }
          }
          throw new Error('Prompt validation tests failed after push.');
        }
      } else {
        console.log(
          'ℹ️ Skipping prompt validation tests (--skip-tests provided).',
        );
        if (backupContent !== null) {
          await fs.unlink(backupPath);
          console.log(
            '✅ Cleaned up local backup after skipped tests: ${backupPath}',
          );
        }
      }
    } catch (error) {
      console.error('❌ Push operation failed:', error);
      try {
        const backupExists = await fs
          .stat(backupPath)
          .then(() => true)
          .catch(() => false);
        if (backupExists) {
          await fs.unlink(backupPath);
          console.log('ℹ️ Cleaned up local backup due to error: ${backupPath}');
        }
      } catch (cleanupError) {
        console.error('❌ Error during cleanup after failure:', cleanupError);
      }
      process.exit(1); // Ensure exit on any error
    } finally {
      // 6. Release lock
      if (lockAcquired) {
        await releaseLock(bucket, key);
        console.log('✅ Lock released.');
      }
    }
  }

  switch (command) {
    case 'pull':
      await pullPrompt(filename);
      break;
    case 'push': {
      const bucket = process.env.S3_BUCKET_NAME;
      if (!bucket) {
        console.error('❌ S3_BUCKET_NAME not configured');
        process.exit(1);
      }
      const key = `site-config/prompts/${filename}`;
      const localPath = path.join(STAGING_DIR, filename);
      const backupPath = path.join(STAGING_DIR, `${filename}.backup`);

      // Call the helper function with necessary parameters
      await handlePushLogic({
        filename,
        site, // Pass site from main scope
        skipTests, // Pass skipTests from main scope
        bucket,
        key,
        localPath,
        backupPath,
      });
      break; // End of case 'push'
    }
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

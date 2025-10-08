import bcrypt from "bcryptjs";
import { PasswordValidation } from "@/types/user";

export function getLastPasswordChangeTimestamp(): number {
  const timestamp = process.env.LAST_PASSWORD_CHANGE_TIMESTAMP;
  return timestamp ? parseInt(timestamp, 10) : 0;
}

export function isTokenValid(token: string): boolean {
  const [, timestampStr] = token.split(":");
  const tokenTimestamp = parseInt(timestampStr, 10);
  const lastPasswordChangeTimestamp = getLastPasswordChangeTimestamp();

  // Convert tokenTimestamp from milliseconds to seconds if necessary
  const tokenTimestampInSeconds = tokenTimestamp > 9999999999 ? Math.floor(tokenTimestamp / 1000) : tokenTimestamp;

  return tokenTimestampInSeconds > lastPasswordChangeTimestamp;
}

/**
 * Validates password strength according to security requirements
 * @param password - The password to validate
 * @returns PasswordValidation object with validation results
 */
export function validatePasswordStrength(password: string): PasswordValidation {
  if (!password || typeof password !== "string") {
    return {
      valid: false,
      message: "Password is required",
    };
  }

  const requirements = {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };

  const allRequirementsMet =
    requirements.minLength && requirements.hasUppercase && requirements.hasLowercase && requirements.hasNumber;

  if (!allRequirementsMet) {
    const missingRequirements: string[] = [];
    if (!requirements.minLength) missingRequirements.push("at least 8 characters");
    if (!requirements.hasUppercase) missingRequirements.push("one uppercase letter");
    if (!requirements.hasLowercase) missingRequirements.push("one lowercase letter");
    if (!requirements.hasNumber) missingRequirements.push("one number");

    return {
      valid: false,
      message: `Password must contain ${missingRequirements.join(", ")}`,
      requirements,
    };
  }

  return {
    valid: true,
    message: "Password meets all requirements",
    requirements,
  };
}

/**
 * Hashes a password using bcrypt with salt rounds 10
 * @param password - The plaintext password to hash
 * @returns Promise resolving to the hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

/**
 * Compares a plaintext password with a hashed password
 * @param password - The plaintext password
 * @param hash - The hashed password to compare against
 * @returns Promise resolving to true if passwords match, false otherwise
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

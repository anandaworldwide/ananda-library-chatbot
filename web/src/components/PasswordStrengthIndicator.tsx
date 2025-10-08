import { PasswordValidation } from "@/types/user";

interface PasswordStrengthIndicatorProps {
  validation: PasswordValidation | null;
  password: string;
}

export function PasswordStrengthIndicator({ validation, password }: PasswordStrengthIndicatorProps) {
  if (!password) return null;

  const requirements = validation?.requirements || {
    minLength: false,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
  };

  const RequirementItem = ({ met, text }: { met: boolean; text: string }) => (
    <li className={`text-sm ${met ? "text-green-600" : "text-gray-500"}`}>
      <span className="mr-2">{met ? "✓" : "○"}</span>
      {text}
    </li>
  );

  return (
    <div className="mt-2 p-3 bg-gray-50 rounded border border-gray-200">
      <p className="text-sm font-medium text-gray-700 mb-2">Password requirements:</p>
      <ul className="space-y-1">
        <RequirementItem met={requirements.minLength} text="At least 8 characters" />
        <RequirementItem met={requirements.hasUppercase} text="One uppercase letter" />
        <RequirementItem met={requirements.hasLowercase} text="One lowercase letter" />
        <RequirementItem met={requirements.hasNumber} text="One number" />
      </ul>
    </div>
  );
}

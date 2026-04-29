# M17 Clarification Dialog - UX Update

## **Change Request: Step-by-Step Question Flow**

### **Current Behavior (WRONG):**
- Shows all 3-5 questions at once on one screen
- User answers all questions before submitting
- Single submit button at the bottom

### **New Behavior (CORRECT):**
- **One question at a time** with step-by-step wizard
- **4 regular button options** + **1 text input option** per question
- **"Skip this question" button** on every question
- Progress indicator (●●○ dots)
- Back/Next navigation between questions

---

## **Updated Component Design**

### **File: `app/_components/AIClarificationDialog.tsx`**

```tsx
'use client';

import { useState } from 'react';
import type { ClarificationQuestion, UserAnswers } from '@/lib/ai/types';

type Props = {
  isOpen: boolean;
  questions: ClarificationQuestion[];
  onSubmit: (answers: UserAnswers) => Promise<void>;
  onSkip: () => Promise<void>;  // Skip ALL questions
  onClose: () => void;
};

export function AIClarificationDialog({
  isOpen,
  questions,
  onSubmit,
  onSkip,
  onClose,
}: Props) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<UserAnswers>({});
  const [customInput, setCustomInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen || questions.length === 0) return null;

  const currentQuestion = questions[currentStep];
  const isLastQuestion = currentStep === questions.length - 1;
  const currentAnswer = answers[currentQuestion.id];

  const handleOptionSelect = (option: string) => {
    setAnswers({ ...answers, [currentQuestion.id]: option });
    setCustomInput(''); // Clear custom input when selecting button
  };

  const handleCustomSubmit = () => {
    if (customInput.trim()) {
      setAnswers({ ...answers, [currentQuestion.id]: customInput.trim() });
    }
  };

  const handleNext = () => {
    // Save custom input if present
    if (customInput.trim() && !currentAnswer) {
      setAnswers({ ...answers, [currentQuestion.id]: customInput.trim() });
    }

    if (isLastQuestion) {
      // Submit all answers
      setIsSubmitting(true);
      onSubmit(answers).catch(() => setIsSubmitting(false));
    } else {
      // Go to next question
      setCurrentStep(currentStep + 1);
      setCustomInput('');
    }
  };

  const handleSkipQuestion = () => {
    // Remove this question's answer and move to next
    const newAnswers = { ...answers };
    delete newAnswers[currentQuestion.id];
    setAnswers(newAnswers);
    setCustomInput('');

    if (isLastQuestion) {
      // Last question - submit what we have
      setIsSubmitting(true);
      onSubmit(newAnswers).catch(() => setIsSubmitting(false));
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setCustomInput('');
    }
  };

  const handleSkipAll = () => {
    onSkip();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="w-full max-w-md rounded-lg border border-ui-border bg-ui-surface p-6">
        {/* Header */}
        <div className="mb-4">
          <h3 className="font-mono text-sm font-medium text-text-primary">
            Question {currentStep + 1} of {questions.length}
          </h3>
          <p className="mt-2 text-lg text-text-primary">
            {currentQuestion.question}
          </p>
        </div>

        {/* Progress Dots */}
        <div className="mb-6 flex gap-2">
          {questions.map((_, idx) => (
            <div
              key={idx}
              className={`h-2 w-2 rounded-full ${
                idx <= currentStep ? 'bg-accent' : 'bg-ui-border'
              }`}
            />
          ))}
        </div>

        {/* Button Options (first 4 options) */}
        <div className="mb-4 space-y-2">
          {currentQuestion.options.slice(0, 4).map((option) => (
            <button
              key={option}
              onClick={() => handleOptionSelect(option)}
              className={`w-full rounded-sm border px-4 py-3 text-left transition-colors ${
                currentAnswer === option
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-ui-border bg-ui-base text-text-secondary hover:border-accent hover:text-accent'
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        {/* Custom Input Option */}
        <div className="mb-6">
          <button
            onClick={() => handleOptionSelect('__custom__')}
            className={`mb-2 w-full rounded-sm border px-4 py-3 text-left transition-colors ${
              currentAnswer === '__custom__' || customInput
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-ui-border bg-ui-base text-text-secondary hover:border-accent hover:text-accent'
            }`}
          >
            Other (type below)
          </button>
          
          <input
            type="text"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onBlur={handleCustomSubmit}
            placeholder="Enter your answer..."
            className="w-full rounded-sm border border-ui-border bg-ui-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between gap-3">
          {/* Back Button */}
          {currentStep > 0 && (
            <button
              onClick={handleBack}
              className="rounded-sm border border-ui-border bg-transparent px-4 py-2 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              ← Back
            </button>
          )}

          {/* Skip This Question */}
          <button
            onClick={handleSkipQuestion}
            disabled={isSubmitting}
            className="rounded-sm border border-ui-border bg-transparent px-4 py-2 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Skip this question
          </button>

          {/* Next / Generate Button */}
          <button
            onClick={handleNext}
            disabled={isSubmitting || (!currentAnswer && !customInput.trim())}
            className="flex-1 rounded-sm bg-accent px-4 py-2 text-sm font-semibold text-canvas transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {isSubmitting
              ? 'Generating...'
              : isLastQuestion
              ? 'Generate →'
              : 'Next →'}
          </button>
        </div>

        {/* Skip All Questions (small link at bottom) */}
        <button
          onClick={handleSkipAll}
          disabled={isSubmitting}
          className="mt-4 w-full text-center text-xs text-text-muted underline hover:text-accent disabled:opacity-50"
        >
          Skip all questions and generate anyway
        </button>
      </div>
    </div>
  );
}
```

---

## **Updated Groq Clarifier Prompt**

Update the system prompt to generate questions that work with this format:

```typescript
const SYSTEM_PROMPT = `You are a Minecraft skin designer assistant. Generate 3-5 quick clarifying questions.

QUESTION FORMAT:
Each question gets exactly 4 button options + 1 custom text input.
The 4 buttons should be the most common/useful choices.
The text input lets users type anything else.

EXAMPLE OUTPUT:
{
  "needsClarification": true,
  "questions": [
    {
      "id": "style",
      "question": "What art style?",
      "options": ["Pixel art", "Realistic", "Cartoon", "Anime"],
      "type": "single_select"
    },
    {
      "id": "armor",
      "question": "Armor type?",
      "options": ["Full plate", "Chainmail", "Leather", "Fantasy"],
      "type": "single_select"
    },
    {
      "id": "variant",
      "question": "Arm width?",
      "options": ["Classic (4px arms)", "Slim (3px arms)"],
      "type": "single_select"
    }
  ]
}

RULES:
- Always provide exactly 4 options per question
- Questions should be short (under 40 chars)
- Options should be 1-3 words each
- Keep to 3-5 questions total
- Focus on the most ambiguous aspects of the prompt
`;
```

---

## **Key UX Improvements**

✅ **Progressive Disclosure** - One question at a time reduces cognitive load
✅ **Always 4 Buttons + Text Input** - Consistent pattern per question  
✅ **Skip Per Question** - Users can skip individual questions they don't care about
✅ **Visual Progress** - Dots show how far along they are
✅ **Back Navigation** - Can go back to change previous answers
✅ **Skip All Option** - Small link at bottom to bypass entire flow

---

## **Implementation Priority**

1. Update `AIClarificationDialog.tsx` with step-by-step wizard
2. Update `groq-clarifier.ts` system prompt to generate 4-option questions
3. Test the flow with various prompts
4. Deploy and verify UX feels smooth

---

**This makes the clarification flow WAY better!** 🎉

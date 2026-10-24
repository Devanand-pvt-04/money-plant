import { Alert } from 'react-native';
import type { Paise } from '@money-plant/core';
import { budgetConflict } from '@/lib/budgets';
import { formatWholeRupees } from './format';

/**
 * BUD-1: before a budget is set on `categoryId`, asks whether to replace
 * the budgets it would overlap. A parent starts from its sub-categories'
 * total. Resolves with whether to go on and the amount to start from.
 */
export async function askToReplaceBudgets(categoryId: string, name: string): Promise<{ proceed: boolean; start: Paise | null }> {
  const conflict = await budgetConflict(categoryId);
  if (!conflict) return { proceed: true, start: null };
  const [title, message] =
    conflict.kind === 'children'
      ? [
          `Replace ${conflict.names.length === 1 ? 'the sub-category budget' : `${conflict.names.length} sub-category budgets`}?`,
          `${conflict.names.join(', ')} ${conflict.names.length === 1 ? 'has its own budget' : 'have their own budgets'}. One budget for ${name} covers all of ${name} and replaces them.${conflict.sum > 0 ? ` It starts at their total, ${formatWholeRupees(conflict.sum)}.` : ''}`,
        ]
      : [`Replace ${conflict.name}'s budget?`, `${conflict.name} has one budget for all its sub-categories. A budget for ${name} on its own removes ${conflict.name}'s, so you can budget each sub-category.`];
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve({ proceed: false, start: null }) },
      { text: 'Continue', onPress: () => resolve({ proceed: true, start: conflict.kind === 'children' && conflict.sum > 0 ? conflict.sum : null }) },
    ], { cancelable: true, onDismiss: () => resolve({ proceed: false, start: null }) }),
  );
}

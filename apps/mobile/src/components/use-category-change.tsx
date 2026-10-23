import { useState } from 'react';
import { Alert } from 'react-native';
import type { CategoryFlow } from '@money-plant/categoriser';
import type { CategoryNode } from '@/lib/categories';
import { addRule, setEntryCategory } from '@/lib/entries';
import { CategoryPicker } from './category-picker';

/**
 * The change-category flow shared by the review inbox and the entry screen:
 * pick a category, then offer "always do this" (CAT-3) and mention any
 * pattern the correction completed (CAT-8).
 */
export function useCategoryChange() {
  const [target, setTarget] = useState<{ id: string; flow: CategoryFlow; merchant: string | null } | null>(null);

  async function pick(category: CategoryNode) {
    if (!target) return;
    const { id, merchant } = target;
    setTarget(null);
    try {
      const { offer, proposed } = await setEntryCategory(id, category.id);
      const label = offer?.merchant ? (merchant ?? offer.merchant) : offer?.vpa;
      if (offer && label) {
        Alert.alert(`Always use ${category.name}?`, `Put every payment ${offer.direction === 'credit' ? 'from' : 'to'} ${label} in ${category.name}.`, [
          { text: 'Just this once', style: 'cancel' },
          { text: 'Always', onPress: () => void addRule(offer, category.id) },
        ]);
      } else if (proposed > 0) {
        Alert.alert('New pattern', 'A few of your recent entries look alike. Open Review to accept or decline the pattern.');
      }
    } catch (e) {
      Alert.alert("Couldn't change the category", e instanceof Error ? e.message : String(e));
    }
  }

  const picker = (
    <CategoryPicker visible={target !== null} flow={target?.flow} onPick={pick} onClose={() => setTarget(null)} />
  );
  return {
    picker,
    change: (id: string, flow: CategoryFlow, merchant: string | null) => setTarget({ id, flow, merchant }),
  };
}

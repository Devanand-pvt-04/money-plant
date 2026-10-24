import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import type { CategoryFlow } from '@money-plant/categoriser';
import { NewCategory } from '@/components/category-picker';
import { CategoryIcon, Sheet } from '@/components/sheet';
import { Button, colors, radius } from '@/components/ui';
import { listCategories, type CategoryNode } from '@/lib/categories';
import { useLedger } from '@/lib/use-ledger';

/** CAT-1 and CAT-5: the user's categories, two levels deep, opened from Budgets. */
export default function Categories() {
  const { data: tree } = useLedger(listCategories, [] as CategoryNode[]);
  const [flow, setFlow] = useState<CategoryFlow>('expense');
  const [creating, setCreating] = useState(false);
  const roots = tree.filter((root) => root.flow === flow);

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.segment}>
          {(['expense', 'income'] as const).map((f) => (
            <Pressable
              key={f}
              accessibilityRole="radio"
              accessibilityState={{ selected: flow === f }}
              onPress={() => setFlow(f)}
              style={[styles.segmentItem, flow === f && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, flow === f && styles.segmentTextOn]}>{f === 'expense' ? 'Spending' : 'Income'}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.meta}>
          Add sub-categories inside any category, for example Breakfast inside Food. Budgets and reports add them up into the category above.
        </Text>
        {roots.map((root) => (
          <View key={root.id} style={styles.group}>
            <Row node={root} />
            {root.children.map((child) => (
              <Row key={child.id} node={child} child />
            ))}
          </View>
        ))}
        <Button title="New category" variant="secondary" onPress={() => setCreating(true)} />
      </ScrollView>
      <Sheet visible={creating} onClose={() => setCreating(false)} title={flow === 'expense' ? 'New spending category' : 'New income category'}>
        <NewCategory
          initialName=""
          parents={roots.filter((r) => !r.system)}
          flow={flow}
          onCancel={() => setCreating(false)}
          onCreated={() => setCreating(false)}
        />
      </Sheet>
    </>
  );
}

function Row({ node, child = false }: { node: CategoryNode; child?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={node.system}
      onPress={() => router.push(`/category/${node.id}`)}
      style={({ pressed }) => [styles.row, child && styles.child, pressed && styles.pressed]}
    >
      {!child && <CategoryIcon categoryKey={node.key} size={30} />}
      <Text style={[styles.name, !child && styles.parent]} numberOfLines={1}>
        {node.name}
      </Text>
      {node.system ? <Text style={styles.meta}>Built in</Text> : <Feather name="chevron-right" size={18} color={colors.muted} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48, gap: 10 },
  segment: { flexDirection: 'row', backgroundColor: colors.subtle, borderRadius: radius.sm, padding: 3 },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.ink },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.muted },
  segmentTextOn: { color: colors.onInk },
  meta: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  group: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14 },
  child: { paddingLeft: 56, minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  pressed: { backgroundColor: colors.pressed },
  name: { flex: 1, fontSize: 15, color: colors.text },
  parent: { fontWeight: '600' },
});

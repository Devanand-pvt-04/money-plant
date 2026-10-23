import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { CategoryFlow } from '@money-plant/categoriser';
import { CategoryPicker } from '@/components/category-picker';
import { Button, Chip, Chips, ErrorText, Field, SectionTitle, colors } from '@/components/ui';
import { createCategory, listCategories, type CategoryNode } from '@/lib/categories';
import { useLedger } from '@/lib/use-ledger';

/** CAT-1 and CAT-5: the category tree, two levels deep. */
export default function Categories() {
  const { data: tree } = useLedger(listCategories, [] as CategoryNode[]);
  const [name, setName] = useState('');
  const [flow, setFlow] = useState<CategoryFlow>('expense');
  const [parent, setParent] = useState<CategoryNode | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    try {
      await createCategory({ name, parentId: parent?.id ?? null, flow: parent?.flow ?? flow });
      setName('');
      setParent(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const section = (title: string, f: CategoryFlow) => (
    <>
      <SectionTitle>{title}</SectionTitle>
      {tree
        .filter((root) => root.flow === f)
        .map((root) => (
          <View key={root.id} style={styles.group}>
            <Row node={root} />
            {root.children.map((child) => (
              <Row key={child.id} node={child} child />
            ))}
          </View>
        ))}
    </>
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.form}>
        <Field label="New category" value={name} onChangeText={setName} placeholder="Pets" maxLength={80} />
        <Text style={styles.label}>Under</Text>
        <Chips>
          <Chip label="Top level" selected={parent === null} onPress={() => setParent(null)} />
          <Chip label={parent ? parent.name : 'Pick a parent…'} selected={parent !== null} onPress={() => setPicking(true)} />
        </Chips>
        {parent === null && (
          <Chips>
            <Chip label="Spending" selected={flow === 'expense'} onPress={() => setFlow('expense')} />
            <Chip label="Income" selected={flow === 'income'} onPress={() => setFlow('income')} />
          </Chips>
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <Button title="Add category" onPress={add} disabled={name.trim() === ''} />
      </View>
      {section('Spending', 'expense')}
      {section('Income', 'income')}
      <CategoryPicker
        visible={picking}
        topLevelOnly
        title="Put it under"
        onPick={(node) => {
          setParent(node);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </ScrollView>
  );
}

function Row({ node, child = false }: { node: CategoryNode; child?: boolean }) {
  return (
    <Pressable
      disabled={node.system}
      onPress={() => router.push(`/category/${node.id}`)}
      style={({ pressed }) => [styles.row, child && styles.child, pressed && styles.pressed]}
    >
      <Text style={[styles.name, !child && styles.parent]}>{node.name}</Text>
      {node.system && <Text style={styles.meta}>Built in</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 48, gap: 8 },
  form: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  label: { fontSize: 14, color: colors.muted },
  group: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16 },
  child: { paddingLeft: 32, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  pressed: { backgroundColor: '#E3F1E8' },
  name: { fontSize: 16, color: colors.text },
  parent: { fontWeight: '600' },
  meta: { fontSize: 13, color: colors.muted },
});

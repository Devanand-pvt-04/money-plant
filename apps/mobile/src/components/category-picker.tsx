import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import type { CategoryFlow } from '@money-plant/categoriser';
import { createCategory, flatten, listCategories, type CategoryNode } from '@/lib/categories';
import { kvGet, kvSet } from '@/lib/kv';
import { CategoryIcon, Sheet } from './sheet';
import { Button, colors, radius } from './ui';

const RECENT_KEY = 'picker.recentCategories';
const RECENT_SHOWN = 4;

interface Props {
  visible: boolean;
  /** Only show spending or only income categories. */
  flow?: CategoryFlow;
  /** Only top-level categories, for picking a parent. */
  topLevelOnly?: boolean;
  /** Ids that can't be picked, such as the category being moved. */
  exclude?: readonly string[];
  /** Offer "New category" at the end (NAV-2). On unless picking a parent. */
  allowCreate?: boolean;
  title?: string;
  onPick: (category: CategoryNode) => void;
  onClose: () => void;
}

type Row = { node: CategoryNode; depth: 0 | 1; parentName?: string };

/**
 * NAV-2: one searchable category sheet. Recent picks first, then every
 * category with its sub-categories (CAT-5), and a way to make a new one
 * without leaving the screen.
 */
export function CategoryPicker(props: Props) {
  const { visible, flow, topLevelOnly, exclude = [], title = 'Category', onPick, onClose } = props;
  const allowCreate = props.allowCreate ?? !topLevelOnly;
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setOpen(new Set());
      setCreating(false);
      return;
    }
    listCategories().then(setTree);
    kvGet(RECENT_KEY).then((value) => setRecentIds(value ? (JSON.parse(value) as string[]) : []));
  }, [visible]);

  const roots = useMemo(
    () => tree.filter((root) => (!flow || root.flow === flow) && !(topLevelOnly && root.system)),
    [tree, flow, topLevelOnly],
  );
  const pickable = (node: CategoryNode) => !exclude.includes(node.id);

  const q = query.trim().toLowerCase();
  const rows: Row[] = [];
  for (const root of roots) {
    const children = topLevelOnly ? [] : root.children.filter(pickable);
    if (q) {
      if (root.name.toLowerCase().includes(q) && pickable(root)) rows.push({ node: root, depth: 0 });
      for (const child of children) if (child.name.toLowerCase().includes(q)) rows.push({ node: child, depth: 1, parentName: root.name });
      continue;
    }
    if (pickable(root)) rows.push({ node: root, depth: 0 });
    if (open.has(root.id)) for (const child of children) rows.push({ node: child, depth: 1 });
  }

  const byId = new Map(flatten(roots).map((c) => [c.id, c]));
  const recent =
    q || topLevelOnly
      ? []
      : recentIds
          .map((id) => byId.get(id))
          .filter((c): c is CategoryNode => !!c && pickable(c))
          .slice(0, RECENT_SHOWN);

  const keyOf = (node: CategoryNode) => node.key ?? roots.find((r) => r.id === node.parentId)?.key ?? null;

  function pick(node: CategoryNode) {
    const next = [node.id, ...recentIds.filter((id) => id !== node.id)].slice(0, 12);
    kvSet(RECENT_KEY, JSON.stringify(next)).catch(() => {});
    onPick(node);
  }

  const exact = q && flatten(roots).some((c) => c.name.toLowerCase() === q);

  return (
    <Sheet visible={visible} onClose={onClose} title={title} tall>
      {creating ? (
        <NewCategory
          initialName={query.trim()}
          parents={roots.filter((r) => !r.system)}
          flow={flow ?? 'expense'}
          onCancel={() => setCreating(false)}
          onCreated={async (id) => {
            const fresh = await listCategories();
            setTree(fresh);
            const made = flatten(fresh).find((c) => c.id === id);
            if (made) pick(made);
          }}
        />
      ) : (
        <>
          <View style={styles.search}>
            <Feather name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={allowCreate ? 'Search or type a new name' : 'Search'}
              placeholderTextColor={colors.placeholder}
              style={styles.searchInput}
              autoCorrect={false}
              returnKeyType="done"
            />
          </View>
          <FlatList
            data={rows}
            keyExtractor={(row) => row.node.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <>
                {recent.length > 0 && (
                  <>
                    <Text style={styles.section}>Recent</Text>
                    <View style={styles.recent}>
                      {recent.map((c) => (
                        <Pressable
                          key={c.id}
                          accessibilityRole="button"
                          onPress={() => pick(c)}
                          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                        >
                          <CategoryIcon categoryKey={keyOf(c)} size={36} />
                          <Text style={styles.tileText} numberOfLines={1}>
                            {c.name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
                <Text style={styles.section}>{q ? 'Matches' : 'All categories'}</Text>
              </>
            }
            ListEmptyComponent={<Text style={styles.empty}>No category called “{query.trim()}” yet.</Text>}
            renderItem={({ item }) => {
              const children = item.depth === 0 && !q && !topLevelOnly ? item.node.children.filter(pickable) : [];
              const expanded = open.has(item.node.id);
              return (
                <View style={[styles.row, item.depth === 1 && styles.child]}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => pick(item.node)}
                    style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
                  >
                    <CategoryIcon categoryKey={keyOf(item.node)} size={item.depth === 0 ? 32 : 26} />
                    <View style={styles.rowText}>
                      <Text style={[styles.name, item.depth === 0 && styles.parent]}>{item.node.name}</Text>
                      {item.parentName && <Text style={styles.meta}>in {item.parentName}</Text>}
                      {children.length > 0 && !expanded && (
                        <Text style={styles.meta} numberOfLines={1}>
                          {children.map((c) => c.name).join(', ')}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                  {children.length > 0 && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={expanded ? `Hide ${item.node.name}'s sub-categories` : `Show ${item.node.name}'s sub-categories`}
                      hitSlop={8}
                      onPress={() => {
                        const next = new Set(open);
                        if (expanded) next.delete(item.node.id);
                        else next.add(item.node.id);
                        setOpen(next);
                      }}
                      style={styles.expand}
                    >
                      <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
                    </Pressable>
                  )}
                </View>
              );
            }}
          />
          {allowCreate && (
            <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={({ pressed }) => [styles.create, pressed && styles.pressed]}>
              <Feather name="plus" size={18} color={colors.primary} />
              <Text style={styles.createText}>{q && !exact ? `New category “${query.trim()}”` : 'New category'}</Text>
            </Pressable>
          )}
        </>
      )}
    </Sheet>
  );
}

/** The short form behind "New category": a name, and optionally a parent. */
function NewCategory(props: {
  initialName: string;
  parents: CategoryNode[];
  flow: CategoryFlow;
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState(props.initialName);
  const [parentId, setParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      props.onCreated(await createCategory({ name, parentId, flow: props.flow }));
    } catch (e) {
      setSaving(false);
      Alert.alert("Couldn't add", e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <View style={styles.form}>
      <Text style={styles.section}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Breakfast"
        placeholderTextColor={colors.placeholder}
        style={styles.input}
        maxLength={40}
        autoFocus
        onSubmitEditing={save}
      />
      <Text style={styles.section}>Inside</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.parents} keyboardShouldPersistTaps="handled">
        {[null, ...props.parents].map((p) => {
          const selected = (p?.id ?? null) === parentId;
          return (
            <Pressable
              key={p?.id ?? 'none'}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setParentId(p?.id ?? null)}
              style={[styles.parentOption, selected && styles.parentOptionOn]}
            >
              {p && <CategoryIcon categoryKey={p.key} size={22} />}
              <Text style={[styles.parentText, selected && styles.parentTextOn]}>{p ? p.name : 'Nothing, its own category'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.formActions}>
        <Button title="Add category" onPress={save} disabled={!name.trim()} loading={saving} />
        <Button title="Back" variant="secondary" onPress={props.onCancel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    backgroundColor: colors.subtle,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.text, paddingVertical: 8 },
  section: { fontSize: 12, fontWeight: '600', color: colors.muted, marginTop: 8, marginBottom: 6, marginHorizontal: 4 },
  recent: { flexDirection: 'row', gap: 8 },
  tile: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.subtle,
  },
  tileText: { fontSize: 12, color: colors.text, maxWidth: '90%' },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  child: { paddingLeft: 24 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 4 },
  rowText: { flex: 1, gap: 2 },
  pressed: { backgroundColor: colors.pressed },
  name: { fontSize: 15, color: colors.text },
  parent: { fontWeight: '600' },
  meta: { fontSize: 12, color: colors.muted },
  expand: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 14, color: colors.muted, marginHorizontal: 4, marginVertical: 12 },
  create: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
  },
  createText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  form: { gap: 4 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  parents: { gap: 8, paddingVertical: 4 },
  parentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  parentOptionOn: { borderColor: colors.ink, backgroundColor: colors.subtle },
  parentText: { fontSize: 14, color: colors.secondary },
  parentTextOn: { color: colors.text, fontWeight: '600' },
  formActions: { gap: 10, marginTop: 16 },
});

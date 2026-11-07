/** A keyset-paged filesystem honoring Puter's name ordering for both listing modes. */
export function pagedFs(objectsPath, tree, { pageCap = Infinity } = {}) {
  const calls = [];
  const fs = {
    calls,
    async readdir(path, options = {}) {
      const call = { path, options: { ...options } };
      calls.push(call);
      const directories = Object.keys(tree).map((day) => ({
        name: day, path: `${objectsPath}/${day}`, is_dir: true,
      }));
      const files = (day) => (tree[day] ?? []).map((name) => ({
        name, path: `${objectsPath}/${day}/${name}`, is_dir: false,
      }));
      const recursive = options.recursive === true;
      let entries = path === objectsPath
        ? (recursive ? [...directories, ...Object.keys(tree).flatMap(files)] : directories)
        : files(path.split('/').pop());
      const field = options.sortBy ?? 'name';
      const descending = options.sortOrder === 'desc';
      const direction = descending ? -1 : 1;
      const compare = (a, b) => direction * (a[field].localeCompare(b[field]) || a.path.localeCompare(b.path));
      entries.sort(compare);
      // An older SDK without cursor support returns this whole array.
      if (!Object.hasOwn(options, 'cursor')) return entries;
      if (options.cursor) {
        const cursor = JSON.parse(options.cursor);
        if (cursor.path !== path || cursor.field !== field || cursor.descending !== descending || cursor.recursive !== recursive) {
          throw new Error('cursor does not match requested directory or sort');
        }
        entries = entries.filter((entry) => compare(entry, cursor.after) > 0);
      }
      const limit = Math.min(pageCap, options.limit ?? 1000);
      const items = entries.slice(0, limit);
      const cursor = entries.length > items.length
        ? JSON.stringify({ path, field, descending, recursive, after: items.at(-1) }) : undefined;
      call.count = items.length;
      return { items, ...(cursor ? { cursor } : {}) };
    },
  };
  return fs;
}

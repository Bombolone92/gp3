import { createContact } from './model.js'

const PEOPLE = [
  ['Amelia', 'Chen', 'Creative Director', 'Northwind Studio', 'Design', 'Vancouver'],
  ['Ben', 'Carter', 'Product Manager', 'Northwind Studio', 'Team', 'Seattle'],
  ['Chloe', 'Martin', 'Brand Designer', 'Atelier Bloom', 'Design', 'Montreal'],
  ['Daniel', 'Kim', 'Engineering Lead', 'Northwind Studio', 'Team', 'Toronto'],
  ['Elena', 'Rossi', 'Founder', 'Forma House', 'Clients', 'Milan'],
  ['Felix', 'Weber', 'Photographer', 'Fieldwork', 'Partners', 'Berlin'],
  ['Grace', 'Okafor', 'Marketing Lead', 'Northwind Studio', 'Team', 'London'],
  ['Hugo', 'Silva', 'Architect', 'Studio Arbor', 'Partners', 'Lisbon'],
  ['Isabel', 'Reyes', 'Operations Lead', 'Northwind Studio', 'Team', 'Austin'],
  ['James', 'Wilson', 'Editor', 'The Sunday Journal', 'Press', 'New York'],
  ['Kai', 'Nakamura', 'Motion Designer', 'Atelier Bloom', 'Design', 'Tokyo'],
  ['Lila', 'Patel', 'Research Lead', 'Northwind Studio', 'Team', 'San Francisco'],
  ['Marco', 'Costa', 'Partnerships Lead', 'Forma House', 'Clients', 'Barcelona'],
  ['Nora', 'Bennett', 'Illustrator', 'Paper & Pine', 'Design', 'Portland'],
  ['Owen', 'Brooks', 'Producer', 'Fieldwork', 'Partners', 'Los Angeles'],
  ['Priya', 'Shah', 'Strategy Director', 'Northwind Studio', 'Team', 'Singapore'],
  ['Sofia', 'Andersson', 'Design Lead', 'Studio Arbor', 'Partners', 'Stockholm'],
  ['Theo', 'Laurent', 'Founder', 'Paper & Pine', 'Clients', 'Paris'],
]

/** A fresh, additive demo batch. The caller supplies the currently loaded store. */
export function createSampleDataPopulator(getStore) {
  let pending = null
  return function populateSampleData() {
    if (!pending) pending = Promise.resolve().then(async () => {
      const store = getStore()
      if (!store?.isFresh()) throw new Error('Sign in and wait for Contacts to finish loading before populating sample data.')
      const ids = []
      try {
        for (const [i, [firstName, lastName, jobTitle, company, tag, city]] of PEOPLE.entries()) {
          if (getStore() !== store) throw new Error('The Contacts session changed.')
          const contact = await store.save(createContact({
            firstName, lastName, jobTitle, company,
            emails: [{ label: 'Work', value: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@northwind.example` }],
            phones: [{ label: 'Mobile', value: `+1 202-555-${String(100 + i).padStart(4, '0')}` }],
            addresses: [{ label: 'Work', city }],
            urls: [{ label: 'Work', value: 'https://northwind.example' }],
            birthday: `1990-${String(i % 12 + 1).padStart(2, '0')}-${String(i + 3).padStart(2, '0')}`,
            tags: ['Sample data', tag], favorite: i % 4 === 0,
            notes: `Fictional demo contact. ${firstName} is our ${jobTitle.toLowerCase()} contact at ${company}.\nDiscuss the autumn studio launch and share the latest creative brief.`,
          }))
          ids.push(contact.id)
        }
      } catch (cause) {
        throw new Error(`Sample data stopped after ${ids.length} contacts were saved. Those contacts remain in your address book.`, { cause })
      }
      store.setUI({ query: '', favoritesOnly: false, tag: 'Sample data', selectedId: ids[0], cursorId: ids[0], selectMode: false, checked: new Set() })
      return { created: ids.length, ids, tag: 'Sample data' }
    }).finally(() => { pending = null })
    return pending
  }
}

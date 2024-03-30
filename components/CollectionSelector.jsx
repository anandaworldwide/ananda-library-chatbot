export default function CollectionSelector({ onCollectionChange, currentCollection }) {
  return (
    <div className="flex items-center">
      <label htmlFor="collection" className="text-lg font-bold text-gray-700 mr-3">Collection:</label>
      <select
        id="collection"
        value={currentCollection}
        onChange={(e) => onCollectionChange(e.target.value)}
        className="block w-full pl-3 pr-10 py-3 text-lg border-gray-300 
        focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 rounded-md"
      >
        <option value="master_swami">Master and Swamiji</option>
        <option value="whole_library">Whole Library</option>
      </select>
    </div>
  );
}
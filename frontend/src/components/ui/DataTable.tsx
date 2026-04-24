/**
 * Reusable Data Table Component
 */

interface Column<T> {
  header: string
  accessor: keyof T | string
  render?: (row: T) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  emptyMessage?: string
  emptyIcon?: React.ReactNode
  onRowClick?: (row: T) => void
}

export default function DataTable<T extends { id: number | string }>({
  columns,
  data,
  emptyMessage = 'No data found',
  emptyIcon,
  onRowClick
}: DataTableProps<T>) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="min-w-0 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]">
        <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                className="px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500 sm:px-4 sm:py-3 sm:text-xs md:px-6"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center sm:px-6 sm:py-12">
                {emptyIcon && <div className="flex justify-center mb-4">{emptyIcon}</div>}
                <p className="text-gray-600">{emptyMessage}</p>
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                key={row.id}
                className={`hover:bg-gray-50 ${onRowClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((column, colIndex) => (
                  <td
                    key={colIndex}
                    className="max-w-[11rem] px-3 py-2.5 text-xs text-gray-900 sm:max-w-none sm:whitespace-nowrap sm:px-4 sm:py-3 sm:text-sm md:px-6"
                  >
                    {column.render
                      ? column.render(row)
                      : String(row[column.accessor as keyof T] ?? '-')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}


















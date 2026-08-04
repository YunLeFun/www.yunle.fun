import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDirectory = resolve(packageRoot, 'src/generated')
const targetDirectory = resolve(packageRoot, 'dist/generated')

mkdirSync(targetDirectory, { recursive: true })

for (const fileName of ['development-registry.json', 'production-registry.json']) {
  copyFileSync(
    resolve(sourceDirectory, fileName),
    resolve(targetDirectory, fileName),
  )
}

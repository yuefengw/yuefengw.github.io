import Hexo from 'hexo'

const command = process.argv[2] || 'generate'
const commandArgs = {}
for (let index = 3; index < process.argv.length; index += 1) {
  const argument = process.argv[index]
  if (argument === '--draft') commandArgs.draft = true
  if (argument === '--port' && process.argv[index + 1]) {
    commandArgs.port = Number(process.argv[index + 1])
    index += 1
  }
}
const hexo = new Hexo(process.cwd(), { init: true })
hexo.env.init = true

await hexo.init()
await hexo.call(command, commandArgs)
await hexo.exit()

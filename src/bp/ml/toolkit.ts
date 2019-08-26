import * as sdk from 'botpress/sdk'
import cluster from 'cluster'

import { registerListener } from '../cluster'
const { Tagger, Trainer: CRFTrainer } = require('./crfsuite')
import { FastTextModel } from './fasttext'
import computeJaroWinklerDistance from './homebrew/jaro-winkler'
import computeLevenshteinDistance from './homebrew/levenshtein'
import { processor } from './sentencepiece'
import { Predictor, Trainer as SVMTrainer } from './svm'

const MLToolkit: typeof sdk.MLToolkit = {
  CRF: {
    createTagger: Tagger,
    createTrainer: CRFTrainer
  },
  SVM: {
    Predictor,
    Trainer: SVMTrainer
  },
  FastText: { Model: FastTextModel },
  Strings: { computeLevenshteinDistance, computeJaroWinklerDistance },
  SentencePiece: { createProcessor: processor }
}

if (cluster.isWorker) {
  MLToolkit.SVM.Trainer.prototype.train = (
    points: sdk.MLToolkit.SVM.DataPoint[],
    options?: Partial<sdk.MLToolkit.SVM.SVMOptions>,
    progressCb?: sdk.MLToolkit.SVM.TrainProgressCallback | undefined
  ): any => {
    return Promise.fromCallback(completedCb => {
      const messageHandler = msg => {
        if (progressCb && msg.type === 'progress') {
          progressCb(msg.progress)
        }

        if (msg.type === 'svm_trained') {
          process.off('message', messageHandler)
          completedCb(undefined, msg.result)
        }
      }

      process.send!({ type: 'svm_train', points, options })
      process.on('message', messageHandler)
    })
  }
}

if (cluster.isMaster) {
  registerListener('svm_train', async (msg, worker) => {
    if (msg.type === 'svm_train') {
      const svm = new SVMTrainer()
      const result = await svm.train(msg.points, msg.options, progress => worker.send({ type: 'progress', progress }))
      worker.send({ type: 'svm_trained', result })
    }
  })
}

export default MLToolkit

import type { NextApiRequest, NextApiResponse } from 'next';
import { getRelatedQuestions, updateRelatedQuestionsBatch } from '@/utils/server/relatedQuestionsUtils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const { questionId } = req.query;

      // Calling /api/relatedQuestions?updateBatch=100 will update the next 100 questions with
      // related questions.
      if (req.query.updateBatch) {
        const batchSize = parseInt(req.query.updateBatch as string);
        console.log('Batch updating related questions with batch size:', batchSize);
        try {
          await updateRelatedQuestionsBatch(batchSize);
          return res.status(200).json({ message: 'Related questions updated successfully' });
        } catch (error: any) {
          console.error('Error updating related questions: ', error);
          return res.status(500).json({ message: 'Error updating related questions', error: error.message });
        }
      }

      if (!questionId || typeof questionId !== 'string') {
        return res.status(400).json({ message: 'questionId parameter is required and must be a string.' });
      }

      const relatedQuestions = await getRelatedQuestions(questionId as string);
      res.status(200).json(relatedQuestions.map(q => ({
        id: q.id,
        title: q.title,
        similarity: q.similarity 
      })));

    } catch (error: any) {
      console.error('Error fetching related questions: ', error);
      res.status(500).json({ message: 'Error fetching related questions', error: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
import { useData } from '../data/DataProvider';
import { hasSample, opsRemoveSample } from '../lib/model';
import { saveWithUndo } from './toast';
import { Button } from './ui';

export function SampleBanner() {
  const d = useData();
  if (!hasSample(d)) return null;
  return (
    <div className="banner">
      <div className="banner-text">
        <strong>Sample history is loaded.</strong> Ten weeks of made-up workouts and check-ins so you can try the calendar and charts. Remove it
        before you start logging for real; your own entries are never touched.
      </div>
      <Button size="sm" onClick={() => saveWithUndo(opsRemoveSample(d), 'Sample data removed')}>
        Remove sample data
      </Button>
    </div>
  );
}

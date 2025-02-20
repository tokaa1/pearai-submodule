import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { defaultModelSelector } from '../redux/selectors/modelSelectors'; // Adjust this import path as needed
import { useLocation } from 'react-router-dom';

export function isPerplexityMode() {
  const location = useLocation();
  return location?.pathname.includes('perplexity')
}


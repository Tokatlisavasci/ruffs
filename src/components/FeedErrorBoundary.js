import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

class FeedErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {}

  render() {
    if (this.state.hasError) {
      return <View style={styles.fallback} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: { width, height, backgroundColor: '#000' },
});

export default FeedErrorBoundary;
